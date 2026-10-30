import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';
import {
  buildServerCheckoutQuote,
  isValidBrazilianCpf,
  ServerQuoteInputSchema,
} from './checkout-quote';
import { formatCurrencyBRL } from './storefront';
import {
  createMercadoPagoPixPayment,
  createMercadoPagoPreference,
  fetchMercadoPagoPayment,
  isMercadoPagoConfigured,
  isMercadoPagoTestMode,
} from './mercadopago';

export const OrderStatusEnum = z.enum([
  'ENCAMINHADO_WHATSAPP',
  'AGUARDANDO_PAGAMENTO',
  'PAGO_EM_PREPARACAO',
  'PRONTO_PARA_ENVIO',
  'ENVIADO',
  'ENTREGUE',
  'CANCELADO',
]);

export type OrderStatusType = z.infer<typeof OrderStatusEnum>;

export const PaymentStatusEnum = z.enum([
  'NAO_INICIADO',
  'PENDENTE',
  'CONFIRMADO',
  'FALHOU',
  'REEMBOLSADO',
]);

export type PaymentStatusType = z.infer<typeof PaymentStatusEnum>;

export const CreateOrderSchema = ServerQuoteInputSchema.extend({
  channel: z.enum(['SITE_CHECKOUT', 'WHATSAPP_ASSISTED']),
  idempotencyKey: z.string().min(8, 'Chave de idempotência é obrigatória.'),
  agreedToMadeToOrderTerms: z.boolean().default(false),
  customer: z.object({
    fullName: z.string().min(3, 'Informe seu nome completo.'),
    cpf: z
      .string()
      .refine((v) => isValidBrazilianCpf(v), 'Informe um CPF válido de 11 dígitos.'),
    email: z.string().email('Informe um e-mail válido.'),
    phoneWhatsapp: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length >= 10 && v.length <= 13, 'Informe um telefone/WhatsApp válido com DDD.'),
  }),
  address: z.object({
    cep: z
      .string()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v.length === 8, 'Informe um CEP válido de 8 dígitos.'),
    street: z.string().min(2, 'Informe a rua/logradouro.'),
    number: z.string().min(1, 'Informe o número do endereço.'),
    complement: z.string().optional().nullable(),
    neighborhood: z.string().min(2, 'Informe o bairro/distrito.'),
    city: z.string().min(2, 'Informe o município.'),
    state: z.string().length(2, 'Informe a UF com 2 letras.'),
    referencePoint: z.string().optional().nullable(),
  }),
  customerNotes: z.string().optional().nullable(),
});

export function generateOrderNumber(): string {
  const year = new Date().getFullYear();
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SA-${year}-${randomPart}`;
}

/**
 * Monta a mensagem estruturada de atendimento pelo WhatsApp preservando a identificação
 * exata de cada variação (SKU, Cor, Modelo, Tamanho, Modalidade e Prazo) e o protocolo do pedido.
 */
export function buildWhatsAppOrderMessage(params: {
  orderNumber: string;
  customerName: string;
  items: Array<{
    snapshotProductName: string;
    snapshotSkuCode: string;
    snapshotColorName: string;
    snapshotModelName: string;
    snapshotSizeLabel: string;
    snapshotSupplyMode: string;
    snapshotPrepDays: number | null;
    quantity: number;
    unitPriceCents: number;
  }>;
  shippingDescription: string;
  paymentMethod: string;
  installments: number;
  totalCents: number;
}): string {
  const lines: string[] = [
    `Olá, STILLUS ALBAN! Gostaria de prosseguir com o atendimento do meu pedido:`,
    `Protocolo: *${params.orderNumber}*`,
    `Cliente: ${params.customerName}`,
    ``,
    `*Itens Selecionados:*`,
  ];

  for (const item of params.items) {
    const modeLabel =
      item.snapshotSupplyMode === 'IN_STOCK'
        ? 'Estoque Próprio'
        : item.snapshotSupplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD'
        ? `Sob Encomenda (${item.snapshotPrepDays}d úteis)`
        : 'Sob Encomenda (Prazo a confirmar)';

    lines.push(
      `- ${item.quantity}x ${item.snapshotProductName} | SKU: ${item.snapshotSkuCode} | Cor: ${item.snapshotColorName} | Modelo: ${item.snapshotModelName} | Tam: ${item.snapshotSizeLabel} [${modeLabel}] — ${formatCurrencyBRL(
        item.unitPriceCents * item.quantity
      )}`
    );
  }

  lines.push(``);
  lines.push(`*Entrega:* ${params.shippingDescription}`);
  lines.push(
    `*Forma de Pagamento Escolhida:* ${
      params.paymentMethod === 'PIX'
        ? 'PIX (com desconto aplicado)'
        : `Cartão de Crédito (${params.installments}x)`
    }`
  );
  lines.push(`*Total Calculado:* ${formatCurrencyBRL(params.totalCents)}`);

  return lines.join('\n');
}

/**
 * Gera URL do Checkout Integrado InfinitePay SOMENTE quando a InfiniteTag (INFINITEPAY_HANDLE)
 * estiver configurada no servidor. Nunca simula pagamento aprovado nem inventa credenciais.
 */
export function buildInfinitePayCheckoutUrl(params: {
  orderNumber: string;
  totalCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: Array<{
    snapshotProductName: string;
    snapshotSkuCode: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}): { configured: boolean; checkoutUrl: string | null } {
  const handle = (process.env.INFINITEPAY_HANDLE || '').trim().replace(/^\$/, '');
  if (!handle) {
    return { configured: false, checkoutUrl: null };
  }

  const baseUrl =
    process.env.INFINITEPAY_CHECKOUT_BASE_URL ||
    `https://checkout.infinitepay.io/${encodeURIComponent(handle)}`;

  const itemsPayload = params.items.map((i) => ({
    name: `${i.snapshotProductName} (${i.snapshotSkuCode})`,
    price: i.unitPriceCents,
    quantity: i.quantity,
  }));

  const search = new URLSearchParams({
    order_nsu: params.orderNumber,
    customer_name: params.customerName,
    customer_email: params.customerEmail,
    customer_cellphone: params.customerPhone,
    items: JSON.stringify(itemsPayload),
  });

  return {
    configured: true,
    checkoutUrl: `${baseUrl}?${search.toString()}`,
  };
}

/**
 * Cria um pedido validando preços, descontos e estoque 100% no servidor, aplicando
 * idempotência por idempotencyKey e preservando o snapshot imutável das variações em OrderItem.
 */
export async function createOrderWithIntegrity(
  rawInput: z.infer<typeof CreateOrderSchema>,
  options?: {
    client?: PrismaClient;
    customFetch?: typeof fetch;
  }
) {
  const client = options?.client ?? defaultPrisma;
  const input = CreateOrderSchema.parse(rawInput);

  // 1. Verifica idempotência antes de criar novo registro
  const existingOrder = await client.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: {
      customer: true,
      items: true,
      shipping: true,
      payments: true,
    },
  });

  if (existingOrder) {
    return { order: existingOrder, idempotentReplay: true };
  }

  // 2. Recalcula valores, descontos (PIX 10%), prazos e frete no servidor
  const quote = await buildServerCheckoutQuote(
    {
      items: input.items,
      destinationCep: input.address.cep,
      selectedShippingOptionId: input.selectedShippingOptionId,
      paymentMethod: input.paymentMethod,
      installments: input.installments,
    },
    { client, customFetch: options?.customFetch }
  );

  // Se houver item sob encomenda no checkout do site, exige ciência explícita do prazo / remessa única
  if (
    input.channel === 'SITE_CHECKOUT' &&
    quote.hasMadeToOrderItems &&
    !input.agreedToMadeToOrderTerms
  ) {
    throw new Error(
      'CIENCIA_ENCOMENDA_OBRIGATORIA: Confirme a ciência das condições de prazo e envio em remessa única para itens sob encomenda.'
    );
  }

  // Se for checkout no site e o CEP possuir opções de frete, exige opção válida selecionada
  if (
    input.channel === 'SITE_CHECKOUT' &&
    !quote.selectedShippingOption
  ) {
    throw new Error(
      'FRETE_NAO_SELECIONADO: Nenhuma modalidade de entrega automática disponível para este CEP no momento. Utilize a opção de encaminhar para atendimento via WhatsApp.'
    );
  }

  const settings = await client.storeSettings.findUnique({ where: { id: 'default' } });
  const reservationMinutes = settings?.stockReservationMinutes ?? 30;
  const orderNumber = generateOrderNumber();

  // 3. Executa criação do pedido + reserva atômica de estoque (quando SITE_CHECKOUT) em transação única
  const createdOrder = await client.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        fullName: input.customer.fullName.trim(),
        cpf: input.customer.cpf.replace(/\D/g, ''),
        email: input.customer.email.trim().toLowerCase(),
        phoneWhatsapp: input.customer.phoneWhatsapp,
      },
    });

    await tx.customerAddress.create({
      data: {
        customerId: customer.id,
        cep: input.address.cep,
        street: input.address.street.trim(),
        number: input.address.number.trim(),
        complement: input.address.complement?.trim() || null,
        neighborhood: input.address.neighborhood.trim(),
        city: input.address.city.trim(),
        state: input.address.state.trim().toUpperCase(),
        referencePoint: input.address.referencePoint?.trim() || null,
      },
    });

    const isSiteCheckout = input.channel === 'SITE_CHECKOUT';
    const orderStatus: OrderStatusType = isSiteCheckout
      ? 'AGUARDANDO_PAGAMENTO'
      : 'ENCAMINHADO_WHATSAPP';
    const paymentStatus: PaymentStatusType = isSiteCheckout ? 'PENDENTE' : 'NAO_INICIADO';

    const reservationExpiry =
      isSiteCheckout && quote.hasInStockItems
        ? new Date(Date.now() + reservationMinutes * 60 * 1000)
        : null;

    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        channel: input.channel,
        orderStatus,
        paymentStatus,
        paymentMethodChosen: input.paymentMethod,
        installments: quote.installments,
        hasMadeToOrderItems: quote.hasMadeToOrderItems,
        maxPrepDays: quote.maxPrepDays,
        hasTbdLeadTimeItem: quote.hasTbdLeadTimeItem,
        subtotalCents: quote.subtotalCents,
        pixDiscountPercentApplied: quote.pixDiscountPercentApplied,
        discountCents: quote.discountCents,
        shippingCents: quote.shippingCents,
        totalCents: quote.totalCents,
        stockReservationExpiresAt: reservationExpiry,
        customerNotes: input.customerNotes?.trim() || null,
        idempotencyKey: input.idempotencyKey,
      },
    });

    // Cria itens do pedido com snapshot imutável e reserva estoque físico para SITE_CHECKOUT
    for (const item of quote.items) {
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          snapshotProductName: item.snapshotProductName,
          snapshotSkuCode: item.snapshotSkuCode,
          snapshotColorName: item.snapshotColorName,
          snapshotModelName: item.snapshotModelName,
          snapshotSizeLabel: item.snapshotSizeLabel,
          snapshotImageUrl: item.snapshotImageUrl,
          snapshotSupplyMode: item.snapshotSupplyMode,
          snapshotPrepDays: item.snapshotPrepDays,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          lineTotalCents: item.lineTotalCents,
        },
      });

      if (isSiteCheckout && item.snapshotSupplyMode === 'IN_STOCK') {
        const beforeVar = await tx.productVariant.findUniqueOrThrow({
          where: { id: item.variantId },
        });

        const rows = await tx.$executeRaw`
          UPDATE ProductVariant
          SET stockReserved = stockReserved + ${item.quantity},
              updatedAt = CURRENT_TIMESTAMP
          WHERE id = ${item.variantId}
            AND isActive = 1
            AND supplyMode = 'IN_STOCK'
            AND (stockOnHand - stockReserved) >= ${item.quantity}
        `;

        if (Number(rows) !== 1) {
          throw new Error(
            `ESTOQUE_INSUFICIENTE: A variação ${item.snapshotSkuCode} acabou de ficar sem saldo suficiente.`
          );
        }

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            orderId: order.id,
            movementType: 'ORDER_RESERVATION',
            quantityDelta: item.quantity,
            previousOnHand: beforeVar.stockOnHand,
            newOnHand: beforeVar.stockOnHand,
            previousReserved: beforeVar.stockReserved,
            newReserved: beforeVar.stockReserved + item.quantity,
            reason: `Reserva automática de ${reservationMinutes} min para o pedido ${order.orderNumber}`,
          },
        });
      }
    }

    // Registra dados de entrega no pedido
    const shipOpt = quote.selectedShippingOption;
    await tx.orderShipping.create({
      data: {
        orderId: order.id,
        shippingMode: shipOpt?.shippingMode || 'MUNICIPIO_PROXIMO_A_COMBINAR',
        carrierName: shipOpt?.carrierName || 'Atendimento STILLUS ALBAN',
        serviceName: shipOpt?.serviceName || 'Frete a combinar no atendimento',
        shippingCostCents: quote.shippingCents,
        carrierDeliveryDays: shipOpt?.carrierDeliveryDays ?? null,
        totalEstimatedBusinessDays: shipOpt?.totalEstimatedBusinessDays ?? null,
        recipientName: input.customer.fullName.trim(),
        cep: input.address.cep,
        street: input.address.street.trim(),
        number: input.address.number.trim(),
        complement: input.address.complement?.trim() || null,
        neighborhood: input.address.neighborhood.trim(),
        city: input.address.city.trim(),
        state: input.address.state.trim().toUpperCase(),
      },
    });

    // Se for SITE_CHECKOUT, registra a transação de pagamento pendente (Mercado Pago ou fallback)
    if (isSiteCheckout) {
      let transactionProvider = 'MANUAL_ADMIN';
      let checkoutUrl: string | null = null;
      let qrCode: string | null = null;
      let qrCodeBase64: string | null = null;
      let ticketUrl: string | null = null;
      let externalId: string | null = null;

      if (isMercadoPagoConfigured()) {
        transactionProvider = 'MERCADOPAGO';
        try {
          if (input.paymentMethod === 'PIX') {
            const pixRes = await createMercadoPagoPixPayment({
              orderNumber: order.orderNumber,
              totalCents: quote.totalCents,
              customerName: input.customer.fullName.trim(),
              customerEmail: input.customer.email.trim(),
              customerCpf: input.customer.cpf,
              idempotencyKey: input.idempotencyKey,
              customFetch: options?.customFetch,
            });
            if (pixRes.success) {
              qrCode = pixRes.qrCode || null;
              qrCodeBase64 = pixRes.qrCodeBase64 || null;
              ticketUrl = pixRes.ticketUrl || null;
              externalId = pixRes.paymentId || null;
              checkoutUrl = pixRes.ticketUrl || null;
            }
          } else {
            const prefRes = await createMercadoPagoPreference({
              orderNumber: order.orderNumber,
              items: quote.items.map((i) => ({
                title: `${i.snapshotProductName} (${i.snapshotColorName} - Tam ${i.snapshotSizeLabel})`,
                unitPriceCents: i.unitPriceCents,
                quantity: i.quantity,
              })),
              shippingCents: quote.shippingCents,
              discountCents: quote.discountCents,
              customerName: input.customer.fullName.trim(),
              customerEmail: input.customer.email.trim(),
              customerCpf: input.customer.cpf,
              maxInstallments: quote.installments,
              customFetch: options?.customFetch,
            });
            if (prefRes.success) {
              externalId = prefRes.preferenceId || null;
              checkoutUrl = isMercadoPagoTestMode()
                ? prefRes.sandboxInitPoint || prefRes.initPoint || null
                : prefRes.initPoint || null;
            }
          }
        } catch {
          // Mantém provider como MERCADOPAGO com checkoutUrl nulo caso ocorra indisponibilidade temporária de rede
        }
      } else {
        const ipCheckout = buildInfinitePayCheckoutUrl({
          orderNumber: order.orderNumber,
          totalCents: quote.totalCents,
          customerName: input.customer.fullName.trim(),
          customerEmail: input.customer.email.trim(),
          customerPhone: input.customer.phoneWhatsapp,
          items: quote.items,
        });
        transactionProvider = 'INFINITEPAY';
        checkoutUrl = ipCheckout.checkoutUrl;
      }

      await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          provider: transactionProvider,
          externalNsuOrId: externalId,
          method: input.paymentMethod,
          amountCents: quote.totalCents,
          installments: quote.installments,
          status: 'PENDING',
          checkoutUrl,
          qrCode,
          qrCodeBase64,
          ticketUrl,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action:
          input.channel === 'SITE_CHECKOUT'
            ? 'ORDER_CREATED_SITE_CHECKOUT'
            : 'ORDER_CREATED_WHATSAPP_ASSISTED',
        entityType: 'Order',
        entityId: order.id,
        afterJson: JSON.stringify({
          orderNumber: order.orderNumber,
          channel: order.channel,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          totalCents: order.totalCents,
        }),
      },
    });

    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        customer: true,
        items: true,
        shipping: true,
        payments: true,
      },
    });
  });

  return { order: createdOrder, idempotentReplay: false };
}

/**
 * Valida assinatura HMAC-SHA256 de notificação Webhook da InfinitePay.
 */
export function verifyInfinitePayWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret?: string
): boolean {
  const secret = (webhookSecret ?? process.env.INFINITEPAY_WEBHOOK_SECRET ?? '').trim();
  if (!secret || !signatureHeader) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const cleanHeader = signatureHeader.replace(/^sha256=/i, '').trim();

  if (expected.length !== cleanHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanHeader));
}

export interface InfinitePayWebhookPayload {
  event_id?: string;
  order_nsu: string;
  transaction_nsu: string;
  paid_amount_cents: number;
  status: 'approved' | 'paid' | 'failed' | 'refunded';
  payment_method?: 'pix' | 'credit_card';
}

/**
 * Processa notificação autenticada da InfinitePay de forma idempotente:
 * - Valida assinatura HMAC-SHA256;
 * - Grava hash único do evento em PaymentWebhookEvent;
 * - Se o mesmo evento chegar repetido, retorna idempotentReplay: true sem alterar estoque duas vezes;
 * - Quando status === 'approved' | 'paid' e valor confere, atualiza paymentStatus -> CONFIRMADO,
 *   orderStatus -> PAGO_EM_PREPARACAO e efetiva a baixa definitiva do estoque reservado.
 */
export async function processInfinitePayWebhook(
  params: {
    rawBody: string;
    signatureHeader: string | null;
    webhookSecretOverride?: string;
  },
  client: PrismaClient = defaultPrisma
) {
  const isValidSig = verifyInfinitePayWebhookSignature(
    params.rawBody,
    params.signatureHeader,
    params.webhookSecretOverride
  );

  if (!isValidSig) {
    throw new Error('ASSINATURA_WEBHOOK_INVALIDA: Assinatura HMAC da notificação não confere.');
  }

  const payload = JSON.parse(params.rawBody) as InfinitePayWebhookPayload;
  if (!payload.order_nsu || !payload.transaction_nsu) {
    throw new Error('PAYLOAD_WEBHOOK_INVALIDO: order_nsu e transaction_nsu são obrigatórios.');
  }

  const eventKeySource =
    payload.event_id || `${payload.order_nsu}:${payload.transaction_nsu}:${payload.status}`;
  const eventIdHash = crypto.createHash('sha256').update(eventKeySource).digest('hex');

  // Verifica idempotência do evento
  const existingEvent = await client.paymentWebhookEvent.findUnique({
    where: { eventIdHash },
  });

  if (existingEvent) {
    return {
      processed: true,
      idempotentReplay: true,
      orderNumber: payload.order_nsu,
    };
  }

  return client.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber: payload.order_nsu },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new Error(`PEDIDO_NAO_ENCONTRADO: Pedido ${payload.order_nsu} não localizado.`);
    }

    const isApproved = payload.status === 'approved' || payload.status === 'paid';

    if (isApproved && payload.paid_amount_cents < order.totalCents) {
      throw new Error(
        `VALOR_DIVERGENTE: Valor pago (${payload.paid_amount_cents}) é inferior ao total do pedido (${order.totalCents}).`
      );
    }

    await tx.paymentWebhookEvent.create({
      data: {
        provider: 'INFINITEPAY',
        eventIdHash,
        rawPayload: params.rawBody,
        signatureValid: true,
        processingResult: isApproved ? 'PAYMENT_CONFIRMED' : `STATUS_${payload.status.toUpperCase()}`,
      },
    });

    if (isApproved && order.paymentStatus !== 'CONFIRMADO') {
      // Efetiva baixa definitiva do estoque reservado para os itens IN_STOCK
      for (const item of order.items) {
        if (item.variantId && item.snapshotSupplyMode === 'IN_STOCK') {
          const beforeVar = await tx.productVariant.findUniqueOrThrow({
            where: { id: item.variantId },
          });

          const rows = await tx.$executeRaw`
            UPDATE ProductVariant
            SET stockOnHand = stockOnHand - ${item.quantity},
                stockReserved = stockReserved - ${item.quantity},
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}
              AND stockOnHand >= ${item.quantity}
              AND stockReserved >= ${item.quantity}
          `;

          if (Number(rows) !== 1) {
            throw new Error(
              `ERRO_BAIXA_ESTOQUE: Reserva inconsistente para a SKU ${item.snapshotSkuCode}.`
            );
          }

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              orderId: order.id,
              movementType: 'PAYMENT_CONFIRMED_DEDUCTION',
              quantityDelta: -item.quantity,
              previousOnHand: beforeVar.stockOnHand,
              newOnHand: beforeVar.stockOnHand - item.quantity,
              previousReserved: beforeVar.stockReserved,
              newReserved: beforeVar.stockReserved - item.quantity,
              reason: `Baixa definitiva via Webhook InfinitePay (${payload.transaction_nsu})`,
            },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'CONFIRMADO',
          orderStatus: 'PAGO_EM_PREPARACAO',
          stockReservationExpiresAt: null,
        },
      });

      const pendingTx = order.payments[0];
      if (pendingTx) {
        await tx.paymentTransaction.update({
          where: { id: pendingTx.id },
          data: {
            externalNsuOrId: payload.transaction_nsu,
            status: 'APPROVED',
            paidAt: new Date(),
          },
        });
      } else {
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            provider: 'INFINITEPAY',
            externalNsuOrId: payload.transaction_nsu,
            method: order.paymentMethodChosen,
            amountCents: order.totalCents,
            installments: order.installments,
            status: 'APPROVED',
            paidAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'WEBHOOK_PAYMENT_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
          beforeJson: JSON.stringify({
            orderStatus: order.orderStatus,
            paymentStatus: order.paymentStatus,
          }),
          afterJson: JSON.stringify({
            orderStatus: 'PAGO_EM_PREPARACAO',
            paymentStatus: 'CONFIRMADO',
            transactionNsu: payload.transaction_nsu,
          }),
        },
      });
    } else if (payload.status === 'failed' && order.paymentStatus !== 'CONFIRMADO') {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'FALHOU' },
      });
    }

    return {
      processed: true,
      idempotentReplay: false,
      orderNumber: order.orderNumber,
    };
  });
}

/**
 * Processa notificação oficial de Webhook ou atualização do Mercado Pago.
 * Valida o status diretamente na API do Mercado Pago, garante idempotência
 * e realiza a baixa definitiva atômica do estoque físico para pedidos aprovados.
 */
export async function processMercadoPagoWebhookNotification(
  params: {
    paymentId: string | number;
    action?: string;
    rawPayload?: string;
    customFetch?: typeof fetch;
  },
  client: PrismaClient = defaultPrisma
) {
  const paymentIdStr = String(params.paymentId);
  const eventKeySource = `mercadopago:${paymentIdStr}:${params.action || 'payment'}`;
  const eventIdHash = crypto.createHash('sha256').update(eventKeySource).digest('hex');

  const existingEvent = await client.paymentWebhookEvent.findUnique({
    where: { eventIdHash },
  });

  if (existingEvent) {
    return {
      processed: true,
      idempotentReplay: true,
    };
  }

  const mpResult = await fetchMercadoPagoPayment(paymentIdStr, params.customFetch);
  if (!mpResult.success || !mpResult.payment) {
    throw new Error(
      `MERCADOPAGO_PAGAMENTO_NAO_ENCONTRADO: ${mpResult.error || 'Erro na consulta do pagamento.'}`
    );
  }

  const payment = mpResult.payment;
  const orderNumber = payment.externalReference;
  if (!orderNumber) {
    throw new Error(`MERCADOPAGO_SEM_REFERENCIA: Pagamento ${payment.id} sem external_reference.`);
  }

  return client.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { orderNumber },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new Error(`PEDIDO_NAO_ENCONTRADO: Pedido ${orderNumber} não localizado.`);
    }

    const isApproved = payment.status === 'approved';

    if (isApproved && payment.paidAmountCents < order.totalCents) {
      throw new Error(
        `VALOR_DIVERGENTE: Valor pago no Mercado Pago (${payment.paidAmountCents}) é inferior ao total do pedido (${order.totalCents}).`
      );
    }

    await tx.paymentWebhookEvent.create({
      data: {
        provider: 'MERCADOPAGO',
        eventIdHash,
        rawPayload: params.rawPayload || JSON.stringify(payment),
        signatureValid: true,
        processingResult: isApproved ? 'PAYMENT_CONFIRMED' : `STATUS_${payment.status.toUpperCase()}`,
      },
    });

    if (isApproved && order.paymentStatus !== 'CONFIRMADO') {
      for (const item of order.items) {
        if (item.variantId && item.snapshotSupplyMode === 'IN_STOCK') {
          const beforeVar = await tx.productVariant.findUniqueOrThrow({
            where: { id: item.variantId },
          });

          const rows = await tx.$executeRaw`
            UPDATE ProductVariant
            SET stockOnHand = stockOnHand - ${item.quantity},
                stockReserved = stockReserved - ${item.quantity},
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}
              AND stockOnHand >= ${item.quantity}
              AND stockReserved >= ${item.quantity}
          `;

          if (Number(rows) !== 1) {
            throw new Error(
              `ERRO_BAIXA_ESTOQUE: Reserva inconsistente para a SKU ${item.snapshotSkuCode}.`
            );
          }

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              orderId: order.id,
              movementType: 'PAYMENT_CONFIRMED_DEDUCTION',
              quantityDelta: -item.quantity,
              previousOnHand: beforeVar.stockOnHand,
              newOnHand: beforeVar.stockOnHand - item.quantity,
              previousReserved: beforeVar.stockReserved,
              newReserved: beforeVar.stockReserved - item.quantity,
              reason: `Baixa definitiva via Webhook Mercado Pago (${payment.id})`,
            },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'CONFIRMADO',
          orderStatus: 'PAGO_EM_PREPARACAO',
          stockReservationExpiresAt: null,
        },
      });

      const existingTx = order.payments[0];
      if (existingTx) {
        await tx.paymentTransaction.update({
          where: { id: existingTx.id },
          data: {
            externalNsuOrId: String(payment.id),
            status: 'APPROVED',
            paidAt: payment.dateApproved ? new Date(payment.dateApproved) : new Date(),
          },
        });
      } else {
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            provider: 'MERCADOPAGO',
            externalNsuOrId: String(payment.id),
            method: order.paymentMethodChosen,
            amountCents: order.totalCents,
            installments: order.installments,
            status: 'APPROVED',
            paidAt: payment.dateApproved ? new Date(payment.dateApproved) : new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'MERCADOPAGO_PAYMENT_CONFIRMED',
          entityType: 'Order',
          entityId: order.id,
          beforeJson: JSON.stringify({
            orderStatus: order.orderStatus,
            paymentStatus: order.paymentStatus,
          }),
          afterJson: JSON.stringify({
            orderStatus: 'PAGO_EM_PREPARACAO',
            paymentStatus: 'CONFIRMADO',
            paymentId: payment.id,
          }),
        },
      });
    } else if (
      (payment.status === 'cancelled' || payment.status === 'rejected') &&
      order.paymentStatus !== 'CONFIRMADO'
    ) {
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'FALHOU' },
      });
    }

    return {
      processed: true,
      idempotentReplay: false,
      orderNumber,
      status: payment.status,
    };
  });
}

/**
 * Libera automaticamente reservas de estoque de pedidos AGUARDANDO_PAGAMENTO cujo prazo de
 * 30 minutos expirou sem confirmação de pagamento.
 */
export async function releaseExpiredOrderReservations(
  now: Date = new Date(),
  client: PrismaClient = defaultPrisma
): Promise<number> {
  const expiredOrders = await client.order.findMany({
    where: {
      orderStatus: 'AGUARDANDO_PAGAMENTO',
      paymentStatus: { not: 'CONFIRMADO' },
      stockReservationExpiresAt: { lte: now },
    },
    include: { items: true },
  });

  let releasedCount = 0;

  for (const order of expiredOrders) {
    await client.$transaction(async (tx) => {
      for (const item of order.items) {
        if (item.variantId && item.snapshotSupplyMode === 'IN_STOCK') {
          const beforeVar = await tx.productVariant.findUnique({
            where: { id: item.variantId },
          });

          if (beforeVar && beforeVar.stockReserved >= item.quantity) {
            await tx.$executeRaw`
              UPDATE ProductVariant
              SET stockReserved = stockReserved - ${item.quantity},
                  updatedAt = CURRENT_TIMESTAMP
              WHERE id = ${item.variantId}
                AND stockReserved >= ${item.quantity}
            `;

            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                orderId: order.id,
                movementType: 'RESERVATION_RELEASE',
                quantityDelta: -item.quantity,
                previousOnHand: beforeVar.stockOnHand,
                newOnHand: beforeVar.stockOnHand,
                previousReserved: beforeVar.stockReserved,
                newReserved: beforeVar.stockReserved - item.quantity,
                reason: `Liberação automática de reserva expirada do pedido ${order.orderNumber}`,
              },
            });
          }
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          orderStatus: 'CANCELADO',
          paymentStatus: 'FALHOU',
          stockReservationExpiresAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'ORDER_RESERVATION_EXPIRED_CANCELLED',
          entityType: 'Order',
          entityId: order.id,
          afterJson: JSON.stringify({ orderNumber: order.orderNumber, status: 'CANCELADO' }),
        },
      });
    });

    releasedCount++;
  }

  return releasedCount;
}

/**
 * Permite que a administração confirme manualmente um pagamento (ex.: pedido assistido via WhatsApp
 * ou comprovante conferido) registrando justificativa obrigatória em AuditLog e realizando a baixa
 * atômica do estoque físico das variações IN_STOCK.
 */
export async function adminConfirmOrderPayment(
  params: {
    orderId: string;
    adminUserId?: string | null;
    reason: string;
    externalNsuOrId?: string;
  },
  client: PrismaClient = defaultPrisma
) {
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error('JUSTIFICATIVA_OBRIGATORIA: Informe o motivo/protocolo da confirmação manual.');
  }

  return client.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw new Error('PEDIDO_NAO_ENCONTRADO: Pedido não localizado.');
    }

    if (order.paymentStatus === 'CONFIRMADO') {
      return order;
    }

    const hadReservation =
      order.channel === 'SITE_CHECKOUT' && order.stockReservationExpiresAt !== null;

    for (const item of order.items) {
      if (item.variantId && item.snapshotSupplyMode === 'IN_STOCK') {
        const beforeVar = await tx.productVariant.findUniqueOrThrow({
          where: { id: item.variantId },
        });

        if (hadReservation && beforeVar.stockReserved >= item.quantity) {
          const rows = await tx.$executeRaw`
            UPDATE ProductVariant
            SET stockOnHand = stockOnHand - ${item.quantity},
                stockReserved = stockReserved - ${item.quantity},
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}
              AND stockOnHand >= ${item.quantity}
              AND stockReserved >= ${item.quantity}
          `;
          if (Number(rows) !== 1) {
            throw new Error(`ESTOQUE_INSUFICIENTE: Falha ao baixar reserva da SKU ${item.snapshotSkuCode}.`);
          }

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              orderId: order.id,
              userId: params.adminUserId || null,
              movementType: 'PAYMENT_CONFIRMED_DEDUCTION',
              quantityDelta: -item.quantity,
              previousOnHand: beforeVar.stockOnHand,
              newOnHand: beforeVar.stockOnHand - item.quantity,
              previousReserved: beforeVar.stockReserved,
              newReserved: beforeVar.stockReserved - item.quantity,
              reason: `Baixa manual confirmada pelo Admin: ${params.reason.trim()}`,
            },
          });
        } else {
          // Pedido encaminhado pelo WhatsApp (sem reserva prévia): baixa do saldo disponível
          const rows = await tx.$executeRaw`
            UPDATE ProductVariant
            SET stockOnHand = stockOnHand - ${item.quantity},
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ${item.variantId}
              AND (stockOnHand - stockReserved) >= ${item.quantity}
          `;
          if (Number(rows) !== 1) {
            throw new Error(
              `ESTOQUE_INSUFICIENTE: Saldo disponível insuficiente para a SKU ${item.snapshotSkuCode}.`
            );
          }

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              orderId: order.id,
              userId: params.adminUserId || null,
              movementType: 'PAYMENT_CONFIRMED_DEDUCTION',
              quantityDelta: -item.quantity,
              previousOnHand: beforeVar.stockOnHand,
              newOnHand: beforeVar.stockOnHand - item.quantity,
              previousReserved: beforeVar.stockReserved,
              newReserved: beforeVar.stockReserved,
              reason: `Baixa confirmada em atendimento WhatsApp/Admin: ${params.reason.trim()}`,
            },
          });
        }
      }
    }

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'CONFIRMADO',
        orderStatus: 'PAGO_EM_PREPARACAO',
        stockReservationExpiresAt: null,
      },
      include: { customer: true, items: true, shipping: true, payments: true },
    });

    await tx.paymentTransaction.create({
      data: {
        orderId: order.id,
        provider: 'INFINITEPAY',
        externalNsuOrId:
          params.externalNsuOrId?.trim() || `CONF-MANUAL-${order.orderNumber}-${Date.now()}`,
        method: order.paymentMethodChosen,
        amountCents: order.totalCents,
        installments: order.installments,
        status: 'APPROVED',
        paidAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: params.adminUserId || null,
        action: 'ADMIN_MANUAL_PAYMENT_CONFIRMED',
        entityType: 'Order',
        entityId: order.id,
        beforeJson: JSON.stringify({
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
        }),
        afterJson: JSON.stringify({
          orderStatus: 'PAGO_EM_PREPARACAO',
          paymentStatus: 'CONFIRMADO',
          reason: params.reason.trim(),
        }),
      },
    });

    return updatedOrder;
  });
}

/**
 * Atualiza o status operacional de um pedido (ex.: PRONTO_PARA_ENVIO, ENVIADO, ENTREGUE, CANCELADO)
 * e/ou o código de rastreio, liberando reservas de estoque caso seja cancelado antes do pagamento.
 */
export async function adminUpdateOrderOperationalStatus(
  params: {
    orderId: string;
    adminUserId?: string | null;
    orderStatus: OrderStatusType;
    trackingCode?: string | null;
    internalAdminNotes?: string | null;
  },
  client: PrismaClient = defaultPrisma
) {
  return client.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: { items: true, shipping: true },
    });

    if (!order) {
      throw new Error('PEDIDO_NAO_ENCONTRADO: Pedido não localizado.');
    }

    // Se estiver cancelando um pedido que tinha reserva ativa e ainda não estava pago, libera a reserva
    if (
      params.orderStatus === 'CANCELADO' &&
      order.paymentStatus !== 'CONFIRMADO' &&
      order.stockReservationExpiresAt !== null
    ) {
      for (const item of order.items) {
        if (item.variantId && item.snapshotSupplyMode === 'IN_STOCK') {
          const beforeVar = await tx.productVariant.findUnique({
            where: { id: item.variantId },
          });

          if (beforeVar && beforeVar.stockReserved >= item.quantity) {
            await tx.$executeRaw`
              UPDATE ProductVariant
              SET stockReserved = stockReserved - ${item.quantity},
                  updatedAt = CURRENT_TIMESTAMP
              WHERE id = ${item.variantId}
                AND stockReserved >= ${item.quantity}
            `;

            await tx.inventoryMovement.create({
              data: {
                variantId: item.variantId,
                orderId: order.id,
                userId: params.adminUserId || null,
                movementType: 'RESERVATION_RELEASE',
                quantityDelta: -item.quantity,
                previousOnHand: beforeVar.stockOnHand,
                newOnHand: beforeVar.stockOnHand,
                previousReserved: beforeVar.stockReserved,
                newReserved: beforeVar.stockReserved - item.quantity,
                reason: `Liberação de reserva por cancelamento administrativo do pedido ${order.orderNumber}`,
              },
            });
          }
        }
      }
    }

    if (params.trackingCode !== undefined && order.shipping) {
      await tx.orderShipping.update({
        where: { orderId: order.id },
        data: {
          trackingCode: params.trackingCode?.trim() || null,
        },
      });
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        orderStatus: params.orderStatus,
        adminNotes:
          params.internalAdminNotes !== undefined
            ? params.internalAdminNotes?.trim() || null
            : order.adminNotes,
        stockReservationExpiresAt:
          params.orderStatus === 'CANCELADO' ? null : order.stockReservationExpiresAt,
      },
      include: { customer: true, items: true, shipping: true, payments: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: params.adminUserId || null,
        action: 'ADMIN_ORDER_STATUS_UPDATED',
        entityType: 'Order',
        entityId: order.id,
        beforeJson: JSON.stringify({
          orderStatus: order.orderStatus,
          trackingCode: order.shipping?.trackingCode ?? null,
        }),
        afterJson: JSON.stringify({
          orderStatus: updated.orderStatus,
          trackingCode: updated.shipping?.trackingCode ?? null,
        }),
      },
    });

    return updated;
  });
}

