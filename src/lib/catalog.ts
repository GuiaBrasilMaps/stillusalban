import { PrismaClient, Product, ProductImage, ProductVariant } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';
import { recordAuditLog } from './audit';

export const SupplyModeEnum = z.enum([
  'IN_STOCK',
  'MADE_TO_ORDER_CONFIRMED_LEAD',
  'MADE_TO_ORDER_TBD_LEAD',
  'UNAVAILABLE',
]);

export type SupplyMode = z.infer<typeof SupplyModeEnum>;

export const CreateProductSchema = z.object({
  categoryId: z.string().min(1, 'Categoria é obrigatória.'),
  supplierId: z.string().optional().nullable(),
  name: z.string().min(3, 'Nome do produto deve ter ao menos 3 caracteres.'),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens.'),
  shortDescription: z.string().min(5, 'Descrição curta é obrigatória.'),
  fullDescription: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  careInstructions: z.string().optional().nullable(),
  costPriceCents: z.number().int().nonnegative().optional().default(0),
  basePriceCents: z.number().int().positive('Preço base deve ser maior que zero.'),
  promotionalPriceCents: z.number().int().positive().optional().nullable(),
  status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).default('DRAFT'),
  isFeatured: z.boolean().default(false),
  weightKg: z.number().positive('Peso (kg) é obrigatório para o cálculo do Melhor Envio.'),
  heightCm: z.number().int().positive('Altura (cm) é obrigatória para o Melhor Envio.'),
  widthCm: z.number().int().positive('Largura (cm) é obrigatória para o Melhor Envio.'),
  lengthCm: z.number().int().positive('Comprimento (cm) é obrigatório para o Melhor Envio.'),
});

export const CreateVariantSchema = z
  .object({
    productId: z.string().min(1, 'Produto é obrigatório.'),
    skuCode: z.string().min(2, 'Código SKU é obrigatório.'),
    colorName: z.string().min(1, 'Cor é obrigatória.'),
    colorHex: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor Hex deve estar no formato #RRGGBB.')
      .optional()
      .nullable(),
    modelName: z.string().min(1).default('Padrão'),
    sizeLabel: z.string().min(1, 'Tamanho é obrigatório.'),
    priceOverrideCents: z.number().int().positive().optional().nullable(),
    supplyMode: SupplyModeEnum,
    prepDays: z.number().int().nonnegative().optional().nullable(),
    initialStockOnHand: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (
      data.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' &&
      (!data.prepDays || data.prepDays <= 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prepDays'],
        message:
          'Produtos sob encomenda com prazo confirmado exigem dias úteis de preparação maior que zero.',
      });
    }
    if (data.supplyMode === 'MADE_TO_ORDER_TBD_LEAD' && data.prepDays && data.prepDays > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prepDays'],
        message:
          'Produtos sob encomenda com prazo a definir não devem ter prazo fixo pré-definido.',
      });
    }
  });

export const AttachVariantImageSchema = z.object({
  productId: z.string().min(1),
  colorName: z.string().min(1, 'Informe a cor correspondente à imagem.'),
  modelName: z.string().optional().nullable(),
  url: z.string().min(1, 'URL/caminho da imagem é obrigatório.'),
  altText: z.string().min(3, 'Texto alternativo (acessibilidade) é obrigatório.'),
  displayOrder: z.number().int().nonnegative().default(0),
  isPrimary: z.boolean().default(false),
});

export interface VariantGalleryResolution {
  selectedColorName: string;
  selectedModelName: string;
  hasSpecificImages: boolean;
  primaryImage: ProductImage | null;
  gallery: ProductImage[];
  missingImageNotice: string | null;
  illustrativeFallbackImages: Array<{
    image: ProductImage;
    disclaimer: string;
  }>;
}

/**
 * Regra crítica obrigatória da STILLUS ALBAN:
 * Quando a cliente selecionar uma cor ou modelo, a imagem principal e a galeria
 * devem corresponder estritamente à variação selecionada.
 * Se não houver imagem específica para a cor escolhida, NUNCA retorna imagem de
 * outra cor como se fosse a variação selecionada.
 */
export function resolveVariantGallery(
  allProductImages: ProductImage[],
  selectedColorName: string,
  selectedModelName: string = 'Padrão'
): VariantGalleryResolution {
  const normalizedColor = selectedColorName.trim().toLowerCase();
  const normalizedModel = selectedModelName.trim().toLowerCase();

  // Imagens que pertencem estritamente à cor selecionada (e ao modelo selecionado ou geral daquela cor)
  const matchingColorImages = allProductImages
    .filter((img) => {
      if (!img.colorName) return false;
      const imgColor = img.colorName.trim().toLowerCase();
      if (imgColor !== normalizedColor) return false;
      if (!img.modelName) return true;
      return img.modelName.trim().toLowerCase() === normalizedModel;
    })
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return a.displayOrder - b.displayOrder;
    });

  if (matchingColorImages.length > 0) {
    return {
      selectedColorName,
      selectedModelName,
      hasSpecificImages: true,
      primaryImage: matchingColorImages[0],
      gallery: matchingColorImages,
      missingImageNotice: null,
      illustrativeFallbackImages: [],
    };
  }

  // Caso não haja imagem cadastrada para a cor escolhida:
  // Não retorna nenhuma imagem na galeria principal da variação e prepara o aviso seguro.
  const otherImages = allProductImages.sort((a, b) => a.displayOrder - b.displayOrder);
  return {
    selectedColorName,
    selectedModelName,
    hasSpecificImages: false,
    primaryImage: null,
    gallery: [],
    missingImageNotice: `Imagem específica da cor "${selectedColorName}" (${selectedModelName}) ainda não disponível.`,
    illustrativeFallbackImages: otherImages.map((image) => ({
      image,
      disclaimer: `Foto meramente ilustrativa na cor "${
        image.colorName || 'Geral'
      }" — você selecionou a cor "${selectedColorName}".`,
    })),
  };
}

export interface VariantCommercialState {
  skuCode: string;
  unitPriceCents: number;
  availableStock: number;
  supplyMode: SupplyMode;
  canPurchase: boolean;
  maxPurchaseQuantity: number;
  prepDays: number | null;
  requiresLeadTimeNotice: boolean;
  badgeType:
    | 'IN_STOCK'
    | 'MADE_TO_ORDER_CONFIRMED'
    | 'MADE_TO_ORDER_TBD'
    | 'UNAVAILABLE';
  badgeLabel: string;
  availabilityDescription: string;
}

/**
 * Resolve os 5 estados obrigatórios de estoque e encomenda, preço efetivo e limite de compra da SKU.
 */
export function resolveVariantCommercialState(
  product: Pick<Product, 'basePriceCents' | 'promotionalPriceCents' | 'status'>,
  variant: Pick<
    ProductVariant,
    | 'skuCode'
    | 'priceOverrideCents'
    | 'supplyMode'
    | 'prepDays'
    | 'stockOnHand'
    | 'stockReserved'
    | 'isActive'
  >
): VariantCommercialState {
  const unitPriceCents =
    variant.priceOverrideCents ??
    product.promotionalPriceCents ??
    product.basePriceCents;

  const availableStock = Math.max(0, variant.stockOnHand - variant.stockReserved);
  const mode = variant.supplyMode as SupplyMode;

  if (!variant.isActive || product.status !== 'ACTIVE' || mode === 'UNAVAILABLE') {
    return {
      skuCode: variant.skuCode,
      unitPriceCents,
      availableStock: 0,
      supplyMode: 'UNAVAILABLE',
      canPurchase: false,
      maxPurchaseQuantity: 0,
      prepDays: null,
      requiresLeadTimeNotice: false,
      badgeType: 'UNAVAILABLE',
      badgeLabel: 'Indisponível no momento',
      availabilityDescription: 'Esta combinação de cor, modelo e tamanho não está disponível.',
    };
  }

  if (mode === 'IN_STOCK') {
    if (availableStock <= 0) {
      return {
        skuCode: variant.skuCode,
        unitPriceCents,
        availableStock: 0,
        supplyMode: 'IN_STOCK',
        canPurchase: false,
        maxPurchaseQuantity: 0,
        prepDays: 0,
        requiresLeadTimeNotice: false,
        badgeType: 'UNAVAILABLE',
        badgeLabel: 'Esgotado',
        availabilityDescription: 'Sem unidades disponíveis em estoque próprio no momento.',
      };
    }

    return {
      skuCode: variant.skuCode,
      unitPriceCents,
      availableStock,
      supplyMode: 'IN_STOCK',
      canPurchase: true,
      maxPurchaseQuantity: availableStock,
      prepDays: 0,
      requiresLeadTimeNotice: false,
      badgeType: 'IN_STOCK',
      badgeLabel: `Em estoque (${availableStock} un.)`,
      availabilityDescription: `Disponível em estoque próprio para envio (${availableStock} unidade(s)).`,
    };
  }

  if (mode === 'MADE_TO_ORDER_CONFIRMED_LEAD') {
    const prep = variant.prepDays ?? 0;
    return {
      skuCode: variant.skuCode,
      unitPriceCents,
      availableStock: 0,
      supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
      canPurchase: prep > 0,
      maxPurchaseQuantity: 10,
      prepDays: prep,
      requiresLeadTimeNotice: true,
      badgeType: 'MADE_TO_ORDER_CONFIRMED',
      badgeLabel: `Sob encomenda • Preparação: ${prep} dia(s) útil(is)`,
      availabilityDescription: `Produto vendido sob encomenda com prazo de preparação confirmado de ${prep} dia(s) útil(is), somado ao prazo de entrega.`,
    };
  }

  // MADE_TO_ORDER_TBD_LEAD (Sob encomenda cujo prazo ainda precisa ser definido, mas pode ser pago conforme decisão #3)
  return {
    skuCode: variant.skuCode,
    unitPriceCents,
    availableStock: 0,
    supplyMode: 'MADE_TO_ORDER_TBD_LEAD',
    canPurchase: true,
    maxPurchaseQuantity: 10,
    prepDays: null,
    requiresLeadTimeNotice: true,
    badgeType: 'MADE_TO_ORDER_TBD',
    badgeLabel: 'Sob encomenda • Prazo a confirmar',
    availabilityDescription:
      'Produto vendido sob encomenda. O prazo de preparação será confirmado pela equipe após o pedido.',
  };
}

export async function createProductWithAudit(
  rawInput: z.input<typeof CreateProductSchema>,
  actorUserId: string | null,
  client: PrismaClient = defaultPrisma
) {
  const input = CreateProductSchema.parse(rawInput);

  const product = await client.product.create({
    data: {
      categoryId: input.categoryId,
      supplierId: input.supplierId ?? null,
      name: input.name.trim(),
      slug: input.slug.trim(),
      shortDescription: input.shortDescription.trim(),
      fullDescription: input.fullDescription?.trim() ?? null,
      material: input.material?.trim() ?? null,
      careInstructions: input.careInstructions?.trim() ?? null,
      costPriceCents: input.costPriceCents ?? 0,
      basePriceCents: input.basePriceCents,
      promotionalPriceCents: input.promotionalPriceCents ?? null,
      status: input.status,
      isFeatured: input.isFeatured,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      widthCm: input.widthCm,
      lengthCm: input.lengthCm,
    },
  });

  await recordAuditLog(
    {
      actorUserId,
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: product.id,
      after: product,
    },
    client
  );

  return product;
}

export async function createVariantWithAudit(
  rawInput: z.infer<typeof CreateVariantSchema>,
  actorUserId: string | null,
  client: PrismaClient = defaultPrisma
) {
  const input = CreateVariantSchema.parse(rawInput);

  return client.$transaction(async (tx) => {
    const initialStock = input.supplyMode === 'IN_STOCK' ? input.initialStockOnHand : 0;
    const prepDays =
      input.supplyMode === 'IN_STOCK'
        ? 0
        : input.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD'
        ? input.prepDays ?? 1
        : null;

    const variant = await tx.productVariant.create({
      data: {
        productId: input.productId,
        skuCode: input.skuCode.trim().toUpperCase(),
        colorName: input.colorName.trim(),
        colorHex: input.colorHex ?? null,
        modelName: input.modelName.trim(),
        sizeLabel: input.sizeLabel.trim(),
        priceOverrideCents: input.priceOverrideCents ?? null,
        supplyMode: input.supplyMode,
        prepDays,
        stockOnHand: initialStock,
        stockReserved: 0,
        isActive: input.isActive,
      },
    });

    if (initialStock > 0) {
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          userId: actorUserId,
          movementType: 'INITIAL_LOAD',
          quantityDelta: initialStock,
          previousOnHand: 0,
          newOnHand: initialStock,
          previousReserved: 0,
          newReserved: 0,
          reason: 'Carga inicial no cadastro da SKU',
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'VARIANT_CREATED',
        entityType: 'ProductVariant',
        entityId: variant.id,
        afterJson: JSON.stringify(variant),
      },
    });

    return variant;
  });
}

export async function attachVariantImageWithAudit(
  rawInput: z.infer<typeof AttachVariantImageSchema>,
  actorUserId: string | null,
  client: PrismaClient = defaultPrisma
) {
  const input = AttachVariantImageSchema.parse(rawInput);

  const image = await client.productImage.create({
    data: {
      productId: input.productId,
      colorName: input.colorName.trim(),
      modelName: input.modelName?.trim() || null,
      url: input.url.trim(),
      altText: input.altText.trim(),
      displayOrder: input.displayOrder,
      isPrimary: input.isPrimary,
    },
  });

  await recordAuditLog(
    {
      actorUserId,
      action: 'PRODUCT_IMAGE_ATTACHED',
      entityType: 'ProductImage',
      entityId: image.id,
      after: image,
    },
    client
  );

  return image;
}
