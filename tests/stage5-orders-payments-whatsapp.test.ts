import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { createProductWithAudit, createVariantWithAudit } from '../src/lib/catalog';
import {
  adminConfirmOrderPayment,
  buildWhatsAppOrderMessage,
  createOrderWithIntegrity,
  processInfinitePayWebhook,
  releaseExpiredOrderReservations,
} from '../src/lib/orders';

const VALID_CPF = '52998224725';

test('Etapa 5.1 — Snapshot imutável de OrderItem, ciência obrigatória de encomenda e idempotência por idempotencyKey', async () => {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } });

  const product = await createProductWithAudit(
    {
      categoryId: category.id,
      name: 'Bolsa Stillus Snapshot Test',
      slug: `bolsa-snapshot-${Date.now()}`,
      shortDescription: 'Teste de imutabilidade de pedido',
      basePriceCents: 30000, // R$ 300,00
      status: 'ACTIVE',
      isFeatured: false,
      weightKg: 0.6,
      heightCm: 20,
      widthCm: 28,
      lengthCm: 14,
    },
    null,
    prisma
  );

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  try {
    const varStock = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-ST5-STK-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Couro',
        sizeLabel: 'Único',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 5,
        isActive: true,
      },
      null,
      prisma
    );

    const varEncomenda = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-ST5-ENC-${Date.now()}`,
        colorName: 'Dourado',
        colorHex: '#D4AF37',
        modelName: 'Festa',
        sizeLabel: 'Único',
        priceOverrideCents: 40000, // R$ 400,00
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 8,
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    // 1. Sem ciência explícita de encomenda (agreedToMadeToOrderTerms: false), SITE_CHECKOUT deve bloquear
    await assert.rejects(
      async () => {
        await createOrderWithIntegrity(
          {
            channel: 'SITE_CHECKOUT',
            idempotencyKey: `idem-reject-${Date.now()}`,
            agreedToMadeToOrderTerms: false,
            items: [
              { variantId: varStock.id, quantity: 2 },
              { variantId: varEncomenda.id, quantity: 1 },
            ],
            destinationCep: '29260-000',
            paymentMethod: 'PIX',
            installments: 1,
            customer: {
              fullName: 'Maria Cliente Teste',
              cpf: VALID_CPF,
              email: 'maria@teste.com',
              phoneWhatsapp: '27999998888',
            },
            address: {
              cep: '29260-000',
              street: 'Av. Presidente Vargas',
              number: '100',
              neighborhood: 'Centro',
              city: 'Domingos Martins',
              state: 'ES',
            },
          },
          { client: prisma }
        );
      },
      /CIENCIA_ENCOMENDA_OBRIGATORIA/
    );

    // 2. Com ciência confirmada, cria o pedido no site e reserva 2 unidades da SKU em estoque
    const idemKey = `idem-ok-${Date.now()}`;
    const firstCall = await createOrderWithIntegrity(
      {
        channel: 'SITE_CHECKOUT',
        idempotencyKey: idemKey,
        agreedToMadeToOrderTerms: true,
        items: [
          { variantId: varStock.id, quantity: 2 }, // 2 * 30000 = 60000
          { variantId: varEncomenda.id, quantity: 1 }, // 1 * 40000 = 40000 -> Subtotal 100000
        ],
        destinationCep: '29260-000',
        paymentMethod: 'PIX',
        installments: 1,
        customer: {
          fullName: 'Maria Cliente Teste',
          cpf: VALID_CPF,
          email: 'maria@teste.com',
          phoneWhatsapp: '27999998888',
        },
        address: {
          cep: '29260-000',
          street: 'Av. Presidente Vargas',
          number: '100',
          neighborhood: 'Centro',
          city: 'Domingos Martins',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    createdOrderIds.push(firstCall.order.id);
    createdCustomerIds.push(firstCall.order.customerId);

    assert.equal(firstCall.idempotentReplay, false);
    assert.equal(firstCall.order.orderStatus, 'AGUARDANDO_PAGAMENTO');
    assert.equal(firstCall.order.paymentStatus, 'PENDENTE');
    assert.equal(firstCall.order.subtotalCents, 100000);
    assert.equal(firstCall.order.discountCents, 10000); // 10% PIX
    assert.equal(firstCall.order.totalCents, 90000);

    // 3. Reenvio com a mesma idempotencyKey retorna o mesmo pedido e NÃO duplica reserva de estoque
    const secondCall = await createOrderWithIntegrity(
      {
        channel: 'SITE_CHECKOUT',
        idempotencyKey: idemKey,
        agreedToMadeToOrderTerms: true,
        items: [
          { variantId: varStock.id, quantity: 2 },
          { variantId: varEncomenda.id, quantity: 1 },
        ],
        destinationCep: '29260-000',
        paymentMethod: 'PIX',
        installments: 1,
        customer: {
          fullName: 'Maria Cliente Teste',
          cpf: VALID_CPF,
          email: 'maria@teste.com',
          phoneWhatsapp: '27999998888',
        },
        address: {
          cep: '29260-000',
          street: 'Av. Presidente Vargas',
          number: '100',
          neighborhood: 'Centro',
          city: 'Domingos Martins',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    assert.equal(secondCall.idempotentReplay, true);
    assert.equal(secondCall.order.orderNumber, firstCall.order.orderNumber);

    const varAfterReserve = await prisma.productVariant.findUniqueOrThrow({
      where: { id: varStock.id },
    });
    assert.equal(varAfterReserve.stockOnHand, 5);
    assert.equal(varAfterReserve.stockReserved, 2, 'Reserva não pode ser duplicada no replay');

    // 4. Altera nome e preço do produto no catálogo e comprova que o snapshot do pedido permanece intacto
    await prisma.product.update({
      where: { id: product.id },
      data: {
        name: 'Nome Alterado Depois da Compra',
        basePriceCents: 99900,
      },
    });

    const savedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: firstCall.order.id },
      include: { items: true },
    });
    const stockOrderItem = savedOrder.items.find((i) => i.variantId === varStock.id)!;
    assert.equal(stockOrderItem.snapshotProductName, 'Bolsa Stillus Snapshot Test');
    assert.equal(stockOrderItem.unitPriceCents, 30000);
  } finally {
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: product.id } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [product.id, ...createdOrderIds] } },
    });
    await prisma.product.delete({ where: { id: product.id } });
  }
});

test('Etapa 5.2 — Webhook autenticado e idempotente da InfinitePay e baixa definitiva de estoque', async () => {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'calcados' } });
  const webhookSecret = 'test-webhook-secret-stillus-2026';

  const product = await createProductWithAudit(
    {
      categoryId: category.id,
      name: 'Scarpin Webhook Test',
      slug: `scarpin-webhook-${Date.now()}`,
      shortDescription: 'Teste de webhook InfinitePay',
      basePriceCents: 20000, // R$ 200,00
      status: 'ACTIVE',
      isFeatured: false,
      weightKg: 0.7,
      heightCm: 12,
      widthCm: 22,
      lengthCm: 30,
    },
    null,
    prisma
  );

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  try {
    const variant = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-WH-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Verniz',
        sizeLabel: '37',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 4,
        isActive: true,
      },
      null,
      prisma
    );

    const { order } = await createOrderWithIntegrity(
      {
        channel: 'SITE_CHECKOUT',
        idempotencyKey: `idem-wh-${Date.now()}`,
        agreedToMadeToOrderTerms: false,
        items: [{ variantId: variant.id, quantity: 1 }],
        destinationCep: '29260-000',
        paymentMethod: 'PIX',
        installments: 1,
        customer: {
          fullName: 'Ana Pagamento Webhook',
          cpf: VALID_CPF,
          email: 'ana@teste.com',
          phoneWhatsapp: '27999997777',
        },
        address: {
          cep: '29260-000',
          street: 'Rua Principal',
          number: '50',
          neighborhood: 'Centro',
          city: 'Domingos Martins',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    createdOrderIds.push(order.id);
    createdCustomerIds.push(order.customerId);

    const payloadStr = JSON.stringify({
      event_id: `evt-ip-${order.orderNumber}`,
      order_nsu: order.orderNumber,
      transaction_nsu: `tx-${Date.now()}`,
      paid_amount_cents: order.totalCents, // 18000 (com 10% PIX)
      status: 'approved',
      payment_method: 'pix',
    });

    // 1. Assinatura inválida deve ser rejeitada
    await assert.rejects(
      async () => {
        await processInfinitePayWebhook(
          {
            rawBody: payloadStr,
            signatureHeader: 'assinatura_falsa',
            webhookSecretOverride: webhookSecret,
          },
          prisma
        );
      },
      /ASSINATURA_WEBHOOK_INVALIDA/
    );

    // 2. Assinatura HMAC-SHA256 válida confirma o pagamento e baixa o estoque físico
    const validSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(payloadStr)
      .digest('hex');

    const whResult1 = await processInfinitePayWebhook(
      {
        rawBody: payloadStr,
        signatureHeader: `sha256=${validSig}`,
        webhookSecretOverride: webhookSecret,
      },
      prisma
    );

    assert.equal(whResult1.processed, true);
    assert.equal(whResult1.idempotentReplay, false);

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(updatedOrder.paymentStatus, 'CONFIRMADO');
    assert.equal(updatedOrder.orderStatus, 'PAGO_EM_PREPARACAO');

    const varAfterPaid = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    assert.equal(varAfterPaid.stockOnHand, 3, 'Estoque físico deve cair de 4 para 3');
    assert.equal(varAfterPaid.stockReserved, 0, 'Reserva deve cair de 1 para 0');

    // 3. Reenvio do mesmo webhook (replay) não pode baixar o estoque novamente
    const whResult2 = await processInfinitePayWebhook(
      {
        rawBody: payloadStr,
        signatureHeader: validSig,
        webhookSecretOverride: webhookSecret,
      },
      prisma
    );
    assert.equal(whResult2.idempotentReplay, true);

    const varAfterReplay = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    assert.equal(varAfterReplay.stockOnHand, 3, 'Estoque físico permanece 3 após replay');
  } finally {
    await prisma.paymentWebhookEvent.deleteMany({});
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: product.id } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [product.id, ...createdOrderIds] } },
    });
    await prisma.product.delete({ where: { id: product.id } });
  }
});

test('Etapa 5.3 — Atendimento WhatsApp não registra pedido como pago + Expiração de reserva de 30 min', async () => {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'acessorios' } });

  const product = await createProductWithAudit(
    {
      categoryId: category.id,
      name: 'Carteira WhatsApp & Expiração Test',
      slug: `carteira-wa-${Date.now()}`,
      shortDescription: 'Teste de WhatsApp e expiração de reserva',
      basePriceCents: 15000,
      status: 'ACTIVE',
      isFeatured: false,
      weightKg: 0.25,
      heightCm: 4,
      widthCm: 12,
      lengthCm: 20,
    },
    null,
    prisma
  );

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  try {
    const variant = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-WA-${Date.now()}`,
        colorName: 'Dourado',
        colorHex: '#D4AF37',
        modelName: 'Couro',
        sizeLabel: 'Único',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 3,
        isActive: true,
      },
      null,
      prisma
    );

    // 1. Cria pedido encaminhado ao WhatsApp
    const { order: waOrder } = await createOrderWithIntegrity(
      {
        channel: 'WHATSAPP_ASSISTED',
        idempotencyKey: `idem-wa-${Date.now()}`,
        agreedToMadeToOrderTerms: false,
        items: [{ variantId: variant.id, quantity: 1 }],
        destinationCep: '29260-000',
        paymentMethod: 'PIX',
        installments: 1,
        customer: {
          fullName: 'Clara WhatsApp',
          cpf: VALID_CPF,
          email: 'clara@teste.com',
          phoneWhatsapp: '27999996666',
        },
        address: {
          cep: '29260-000',
          street: 'Rua das Flores',
          number: '12',
          neighborhood: 'Centro',
          city: 'Domingos Martins',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    createdOrderIds.push(waOrder.id);
    createdCustomerIds.push(waOrder.customerId);

    assert.equal(waOrder.orderStatus, 'ENCAMINHADO_WHATSAPP');
    assert.equal(
      waOrder.paymentStatus,
      'NAO_INICIADO',
      'Encaminhamento ao WhatsApp jamais deve marcar o pedido como pago'
    );

    const msg = buildWhatsAppOrderMessage({
      orderNumber: waOrder.orderNumber,
      customerName: waOrder.customer.fullName,
      items: waOrder.items,
      shippingDescription: 'Entrega a Combinar — Domingos Martins/ES',
      paymentMethod: waOrder.paymentMethodChosen,
      installments: waOrder.installments,
      totalCents: waOrder.totalCents,
    });
    assert.ok(msg.includes(waOrder.orderNumber), 'Mensagem deve conter o protocolo #SA');
    assert.ok(msg.includes(variant.skuCode), 'Mensagem deve conter a SKU exata');

    // 2. Confirmação manual pelo Admin exige justificativa
    await assert.rejects(
      async () => {
        await adminConfirmOrderPayment(
          {
            orderId: waOrder.id,
            adminUserId: null,
            reason: '',
          },
          prisma
        );
      },
      /JUSTIFICATIVA_OBRIGATORIA/
    );

    // 3. Cria pedido SITE_CHECKOUT que reserva 2 unidades e simula expiração de 30 minutos
    const { order: expOrder } = await createOrderWithIntegrity(
      {
        channel: 'SITE_CHECKOUT',
        idempotencyKey: `idem-exp-${Date.now()}`,
        agreedToMadeToOrderTerms: false,
        items: [{ variantId: variant.id, quantity: 2 }],
        destinationCep: '29260-000',
        paymentMethod: 'CREDIT_CARD',
        installments: 3,
        customer: {
          fullName: 'Cliente Reserva Expirada',
          cpf: VALID_CPF,
          email: 'exp@teste.com',
          phoneWhatsapp: '27999995555',
        },
        address: {
          cep: '29260-000',
          street: 'Rua B',
          number: '20',
          neighborhood: 'Centro',
          city: 'Domingos Martins',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    createdOrderIds.push(expOrder.id);
    createdCustomerIds.push(expOrder.customerId);

    // Força stockReservationExpiresAt para 1 minuto no passado
    await prisma.order.update({
      where: { id: expOrder.id },
      data: { stockReservationExpiresAt: new Date(Date.now() - 60_000) },
    });

    const released = await releaseExpiredOrderReservations(new Date(), prisma);
    assert.equal(released, 1, 'Deve liberar exatamente 1 pedido expirado');

    const varAfterRelease = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    });
    assert.equal(varAfterRelease.stockReserved, 0, 'Reserva deve retornar a zero após expirar');

    const cancelledOrder = await prisma.order.findUniqueOrThrow({ where: { id: expOrder.id } });
    assert.equal(cancelledOrder.orderStatus, 'CANCELADO');
  } finally {
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: product.id } },
    });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [product.id, ...createdOrderIds] } },
    });
    await prisma.product.delete({ where: { id: product.id } });
  }
});
