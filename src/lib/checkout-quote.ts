import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';
import { resolveVariantCommercialState, resolveVariantGallery, SupplyMode } from './catalog';
import {
  calculateShippingOptions,
  ShippingPackageItem,
  ShippingQuoteOption,
  ShippingQuoteResult,
} from './shipping';

export function isValidBrazilianCpf(rawCpf: string): boolean {
  const digits = (rawCpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === Number(digits[10]);
}

export const CheckoutLineInputSchema = z.object({
  variantId: z.string().min(1, 'ID da variação (SKU) é obrigatório.'),
  quantity: z.number().int().positive('Quantidade deve ser maior que zero.'),
});

export const ServerQuoteInputSchema = z.object({
  items: z
    .array(CheckoutLineInputSchema)
    .min(1, 'Adicione ao menos 1 produto na sacola para calcular o pedido.'),
  destinationCep: z.string().optional().nullable(),
  selectedShippingOptionId: z.string().optional().nullable(),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD']).default('PIX'),
  installments: z.number().int().min(1).max(12).default(1),
});

export interface ValidatedCheckoutItem {
  variantId: string;
  productId: string;
  productSlug: string;
  snapshotProductName: string;
  snapshotSkuCode: string;
  snapshotColorName: string;
  snapshotModelName: string;
  snapshotSizeLabel: string;
  snapshotImageUrl: string | null;
  snapshotSupplyMode: SupplyMode;
  snapshotPrepDays: number | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  availableStock: number;
  badgeLabel: string;
}

export interface ServerCheckoutQuote {
  items: ValidatedCheckoutItem[];
  hasInStockItems: boolean;
  hasMadeToOrderItems: boolean;
  hasMixedCart: boolean;
  maxPrepDays: number;
  hasTbdLeadTimeItem: boolean;
  subtotalCents: number;
  paymentMethod: 'PIX' | 'CREDIT_CARD';
  installments: number;
  maxInstallmentsAllowed: number;
  pixDiscountPercentConfigured: number;
  pixDiscountPercentApplied: number;
  discountCents: number;
  shippingQuote: ShippingQuoteResult | null;
  selectedShippingOption: ShippingQuoteOption | null;
  shippingCents: number;
  totalCents: number;
}

/**
 * Recalcula preços, descontos autorizados (PIX 10%), disponibilidade de estoque,
 * prazos de preparação sob encomenda e frete 100% no servidor.
 * Qualquer preço enviado pelo navegador é ignorado.
 */
export async function buildServerCheckoutQuote(
  rawInput: z.infer<typeof ServerQuoteInputSchema>,
  options?: {
    client?: PrismaClient;
    customFetch?: typeof fetch;
  }
): Promise<ServerCheckoutQuote> {
  const client = options?.client ?? defaultPrisma;
  const input = ServerQuoteInputSchema.parse(rawInput);

  // Consolida quantidades caso a mesma variantId apareça mais de uma vez
  const qtyByVariantId = new Map<string, number>();
  for (const line of input.items) {
    qtyByVariantId.set(
      line.variantId,
      (qtyByVariantId.get(line.variantId) || 0) + line.quantity
    );
  }

  const variantIds = Array.from(qtyByVariantId.keys());
  const [settings, variants] = await Promise.all([
    client.storeSettings.findUnique({ where: { id: 'default' } }),
    client.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          include: {
            images: {
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
    }),
  ]);

  if (variants.length !== variantIds.length) {
    throw new Error(
      'SKU_NAO_ENCONTRADA: Uma ou mais variações selecionadas não existem mais no catálogo.'
    );
  }

  const pixDiscountPercentConfigured = settings?.pixDiscountPercent ?? 10;
  const maxInstallmentsAllowed = settings?.maxInstallments ?? 12;

  if (input.paymentMethod === 'CREDIT_CARD' && input.installments > maxInstallmentsAllowed) {
    throw new Error(
      `PARCELAMENTO_INVALIDO: O número máximo de parcelas permitido é ${maxInstallmentsAllowed}x.`
    );
  }

  const validatedItems: ValidatedCheckoutItem[] = [];
  const shippingPackages: ShippingPackageItem[] = [];

  for (const variant of variants) {
    const requestedQty = qtyByVariantId.get(variant.id) || 0;
    const commercialState = resolveVariantCommercialState(variant.product, variant);

    if (!commercialState.canPurchase) {
      throw new Error(
        `SKU_INDISPONIVEL: O item "${variant.product.name}" (${variant.colorName} / ${variant.sizeLabel}) não está disponível (${commercialState.badgeLabel}).`
      );
    }

    if (requestedQty > commercialState.maxPurchaseQuantity) {
      throw new Error(
        `ESTOQUE_INSUFICIENTE: O item "${variant.product.name}" (${variant.colorName} / ${variant.sizeLabel}) possui apenas ${commercialState.availableStock} unidade(s) disponível(is) em estoque próprio.`
      );
    }

    const gallery = resolveVariantGallery(
      variant.product.images,
      variant.colorName,
      variant.modelName
    );

    const lineTotalCents = commercialState.unitPriceCents * requestedQty;

    validatedItems.push({
      variantId: variant.id,
      productId: variant.product.id,
      productSlug: variant.product.slug,
      snapshotProductName: variant.product.name,
      snapshotSkuCode: variant.skuCode,
      snapshotColorName: variant.colorName,
      snapshotModelName: variant.modelName,
      snapshotSizeLabel: variant.sizeLabel,
      snapshotImageUrl: gallery.hasSpecificImages ? gallery.primaryImage?.url ?? null : null,
      snapshotSupplyMode: commercialState.supplyMode,
      snapshotPrepDays: commercialState.prepDays,
      unitPriceCents: commercialState.unitPriceCents,
      quantity: requestedQty,
      lineTotalCents,
      availableStock: commercialState.availableStock,
      badgeLabel: commercialState.badgeLabel,
    });

    shippingPackages.push({
      id: variant.skuCode,
      weightKg: variant.product.weightKg,
      heightCm: variant.product.heightCm,
      widthCm: variant.product.widthCm,
      lengthCm: variant.product.lengthCm,
      quantity: requestedQty,
      insuranceValueReais: Number((commercialState.unitPriceCents / 100).toFixed(2)),
    });
  }

  const hasInStockItems = validatedItems.some((i) => i.snapshotSupplyMode === 'IN_STOCK');
  const hasMadeToOrderItems = validatedItems.some(
    (i) =>
      i.snapshotSupplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ||
      i.snapshotSupplyMode === 'MADE_TO_ORDER_TBD_LEAD'
  );
  const hasMixedCart = hasInStockItems && hasMadeToOrderItems;
  const maxPrepDays = validatedItems.reduce(
    (max, i) => Math.max(max, i.snapshotPrepDays ?? 0),
    0
  );
  const hasTbdLeadTimeItem = validatedItems.some(
    (i) => i.snapshotSupplyMode === 'MADE_TO_ORDER_TBD_LEAD'
  );

  const subtotalCents = validatedItems.reduce((sum, i) => sum + i.lineTotalCents, 0);

  const pixDiscountPercentApplied =
    input.paymentMethod === 'PIX' ? pixDiscountPercentConfigured : 0;

  const discountCents =
    input.paymentMethod === 'PIX'
      ? subtotalCents - Math.round(subtotalCents * (1 - pixDiscountPercentApplied / 100))
      : 0;

  let shippingQuote: ShippingQuoteResult | null = null;
  let selectedShippingOption: ShippingQuoteOption | null = null;
  let shippingCents = 0;

  const cleanDestCep = (input.destinationCep || '').replace(/\D/g, '');
  if (cleanDestCep.length === 8) {
    shippingQuote = await calculateShippingOptions(
      {
        destinationCep: cleanDestCep,
        packages: shippingPackages,
        maxPrepDays,
        hasMadeToOrderItems,
        hasTbdPrepDays: hasTbdLeadTimeItem,
        customFetch: options?.customFetch,
      },
      client
    );

    if (shippingQuote.options.length > 0) {
      selectedShippingOption =
        (input.selectedShippingOptionId
          ? shippingQuote.options.find((o) => o.id === input.selectedShippingOptionId)
          : null) ?? shippingQuote.options[0];

      shippingCents = selectedShippingOption?.shippingCostCents ?? 0;
    }
  }

  const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents);

  return {
    items: validatedItems,
    hasInStockItems,
    hasMadeToOrderItems,
    hasMixedCart,
    maxPrepDays,
    hasTbdLeadTimeItem,
    subtotalCents,
    paymentMethod: input.paymentMethod,
    installments: input.paymentMethod === 'PIX' ? 1 : input.installments,
    maxInstallmentsAllowed,
    pixDiscountPercentConfigured,
    pixDiscountPercentApplied,
    discountCents,
    shippingQuote,
    selectedShippingOption,
    shippingCents,
    totalCents,
  };
}
