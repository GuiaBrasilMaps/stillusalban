import { Category, Product, ProductImage, ProductVariant } from '@prisma/client';
import {
  resolveVariantCommercialState,
  resolveVariantGallery,
  SupplyMode,
  VariantCommercialState,
  VariantGalleryResolution,
} from './catalog';

export type ProductWithRelations = Product & {
  category: Category;
  variants: ProductVariant[];
  images: ProductImage[];
};

export interface CatalogFilterInput {
  categorySlug?: string;
  availability?: 'ALL' | 'IN_STOCK' | 'MADE_TO_ORDER';
  color?: string;
  size?: string;
  searchQuery?: string;
  sortBy?: 'recentes' | 'menor_preco' | 'maior_preco';
}

export function calculatePixPriceCents(
  priceCents: number,
  pixDiscountPercent: number = 10
): number {
  const safeDiscount = Math.min(Math.max(0, pixDiscountPercent), 100);
  return Math.round(priceCents * (1 - safeDiscount / 100));
}

export function formatCurrencyBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Filtra e ordena produtos ativos do catálogo respeitando categoria, modalidade
 * (Estoque Próprio vs. Sob Encomenda), cor, tamanho e busca textual.
 */
export function filterAndSortCatalogProducts(
  products: ProductWithRelations[],
  filters: CatalogFilterInput
): ProductWithRelations[] {
  const categorySlug = filters.categorySlug?.trim().toLowerCase() || '';
  const availability = filters.availability || 'ALL';
  const colorFilter = filters.color?.trim().toLowerCase() || '';
  const sizeFilter = filters.size?.trim().toLowerCase() || '';
  const query = filters.searchQuery?.trim().toLowerCase() || '';
  const sortBy = filters.sortBy || 'recentes';

  const filtered = products.filter((prod) => {
    if (prod.status !== 'ACTIVE') return false;

    const activeVariants = prod.variants.filter((v) => v.isActive);
    if (activeVariants.length === 0) return false;

    if (categorySlug && prod.category.slug.toLowerCase() !== categorySlug) {
      return false;
    }

    if (availability === 'IN_STOCK') {
      const hasInStockAvailable = activeVariants.some(
        (v) => v.supplyMode === 'IN_STOCK' && v.stockOnHand - v.stockReserved > 0
      );
      if (!hasInStockAvailable) return false;
    } else if (availability === 'MADE_TO_ORDER') {
      const hasMadeToOrder = activeVariants.some(
        (v) =>
          v.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ||
          v.supplyMode === 'MADE_TO_ORDER_TBD_LEAD'
      );
      if (!hasMadeToOrder) return false;
    }

    if (colorFilter) {
      const hasColor = activeVariants.some(
        (v) => v.colorName.trim().toLowerCase() === colorFilter
      );
      if (!hasColor) return false;
    }

    if (sizeFilter) {
      const hasSize = activeVariants.some(
        (v) => v.sizeLabel.trim().toLowerCase() === sizeFilter
      );
      if (!hasSize) return false;
    }

    if (query) {
      const haystack = [
        prod.name,
        prod.shortDescription,
        prod.fullDescription || '',
        prod.material || '',
        prod.category.name,
        ...activeVariants.map((v) => `${v.skuCode} ${v.colorName} ${v.modelName} ${v.sizeLabel}`),
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const priceA = a.promotionalPriceCents ?? a.basePriceCents;
    const priceB = b.promotionalPriceCents ?? b.basePriceCents;

    if (sortBy === 'menor_preco') return priceA - priceB;
    if (sortBy === 'maior_preco') return priceB - priceA;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return sorted;
}

export interface SizeOptionState {
  sizeLabel: string;
  variantId: string | null;
  skuCode: string | null;
  isCompatibleWithColorAndModel: boolean;
  commercialState: VariantCommercialState | null;
}

export interface VariationSelectionResolution {
  availableColors: Array<{ colorName: string; colorHex: string | null }>;
  availableModelsForColor: string[];
  sizeOptionsForColorAndModel: SizeOptionState[];
  selectedColorName: string;
  selectedModelName: string;
  selectedSizeLabel: string;
  selectedVariant: ProductVariant | null;
  commercialState: VariantCommercialState | null;
  galleryResolution: VariantGalleryResolution;
  pixPriceCents: number | null;
}

/**
 * Constrói a matriz de seleção de Cor, Modelo e Tamanho na página do produto,
 * impedindo combinações incompatíveis e sincronizando foto, preço, estoque e prazo.
 */
export function resolveProductVariationSelection(params: {
  product: Product;
  variants: ProductVariant[];
  images: ProductImage[];
  selectedColorName?: string;
  selectedModelName?: string;
  selectedSizeLabel?: string;
  pixDiscountPercent?: number;
}): VariationSelectionResolution {
  const activeVariants = params.variants.filter((v) => v.isActive);

  // 1. Cores únicas disponíveis no produto
  const colorMap = new Map<string, string | null>();
  for (const v of activeVariants) {
    const cleanColor = v.colorName.trim();
    if (!colorMap.has(cleanColor)) {
      colorMap.set(cleanColor, v.colorHex ?? null);
    }
  }
  const availableColors = Array.from(colorMap.entries()).map(([colorName, colorHex]) => ({
    colorName,
    colorHex,
  }));

  const selectedColorName =
    params.selectedColorName &&
    availableColors.some(
      (c) => c.colorName.toLowerCase() === params.selectedColorName!.trim().toLowerCase()
    )
      ? availableColors.find(
          (c) => c.colorName.toLowerCase() === params.selectedColorName!.trim().toLowerCase()
        )!.colorName
      : availableColors[0]?.colorName || '';

  // 2. Modelos compatíveis com a cor selecionada
  const variantsOfSelectedColor = activeVariants.filter(
    (v) => v.colorName.trim().toLowerCase() === selectedColorName.toLowerCase()
  );

  const availableModelsForColor = Array.from(
    new Set(variantsOfSelectedColor.map((v) => v.modelName.trim()))
  );

  const selectedModelName =
    params.selectedModelName &&
    availableModelsForColor.some(
      (m) => m.toLowerCase() === params.selectedModelName!.trim().toLowerCase()
    )
      ? availableModelsForColor.find(
          (m) => m.toLowerCase() === params.selectedModelName!.trim().toLowerCase()
        )!
      : availableModelsForColor[0] || 'Padrão';

  // 3. Todos os tamanhos cadastrados no produto vs. tamanhos compatíveis com (Cor + Modelo)
  const allDistinctSizes = Array.from(new Set(activeVariants.map((v) => v.sizeLabel.trim())));

  const sizeOptionsForColorAndModel: SizeOptionState[] = allDistinctSizes.map((sizeLabel) => {
    const match = variantsOfSelectedColor.find(
      (v) =>
        v.modelName.trim().toLowerCase() === selectedModelName.toLowerCase() &&
        v.sizeLabel.trim().toLowerCase() === sizeLabel.toLowerCase()
    );

    if (!match) {
      return {
        sizeLabel,
        variantId: null,
        skuCode: null,
        isCompatibleWithColorAndModel: false,
        commercialState: null,
      };
    }

    const commercialState = resolveVariantCommercialState(params.product, match);
    return {
      sizeLabel: match.sizeLabel.trim(),
      variantId: match.id,
      skuCode: match.skuCode,
      isCompatibleWithColorAndModel: true,
      commercialState,
    };
  });

  // Se o tamanho solicitado for incompatível com a cor/modelo atual, seleciona o primeiro tamanho compatível e comprável (ou o primeiro compatível)
  const requestedSizeOption = params.selectedSizeLabel
    ? sizeOptionsForColorAndModel.find(
        (s) =>
          s.sizeLabel.toLowerCase() === params.selectedSizeLabel!.trim().toLowerCase() &&
          s.isCompatibleWithColorAndModel
      )
    : undefined;

  const fallbackPurchasableSize =
    sizeOptionsForColorAndModel.find(
      (s) => s.isCompatibleWithColorAndModel && s.commercialState?.canPurchase
    ) || sizeOptionsForColorAndModel.find((s) => s.isCompatibleWithColorAndModel);

  const chosenSizeOption = requestedSizeOption || fallbackPurchasableSize;
  const selectedSizeLabel = chosenSizeOption?.sizeLabel || '';

  const selectedVariant =
    variantsOfSelectedColor.find(
      (v) =>
        v.modelName.trim().toLowerCase() === selectedModelName.toLowerCase() &&
        v.sizeLabel.trim().toLowerCase() === selectedSizeLabel.toLowerCase()
    ) || null;

  const commercialState = selectedVariant
    ? resolveVariantCommercialState(params.product, selectedVariant)
    : null;

  const galleryResolution = resolveVariantGallery(
    params.images,
    selectedColorName,
    selectedModelName
  );

  const pixPriceCents = commercialState
    ? calculatePixPriceCents(commercialState.unitPriceCents, params.pixDiscountPercent ?? 10)
    : null;

  return {
    availableColors,
    availableModelsForColor,
    sizeOptionsForColorAndModel,
    selectedColorName,
    selectedModelName,
    selectedSizeLabel,
    selectedVariant,
    commercialState,
    galleryResolution,
    pixPriceCents,
  };
}

export interface CartItemSnapshot {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  skuCode: string;
  colorName: string;
  modelName: string;
  sizeLabel: string;
  supplyMode: SupplyMode;
  prepDays: number | null;
  unitPriceCents: number;
  quantity: number;
  maxPurchaseQuantity: number;
  specificImageUrl: string | null;
}

/**
 * Adiciona ou atualiza um item no carrinho preservando a identificação exata da variação (SKU)
 * e impedindo quantidade superior ao estoque disponível daquela variação.
 */
export function addOrUpdateCartItem(
  currentCart: CartItemSnapshot[],
  selection: VariationSelectionResolution,
  product: Pick<Product, 'id' | 'slug' | 'name'>,
  quantityToAdd: number
): CartItemSnapshot[] {
  if (!selection.selectedVariant || !selection.commercialState) {
    throw new Error('VARIACAO_INCOMPLETA: Selecione cor, modelo e tamanho válidos.');
  }

  if (!selection.commercialState.canPurchase) {
    throw new Error(
      `VARIACAO_INDISPONIVEL: A combinação ${selection.selectedVariant.skuCode} não está disponível para compra.`
    );
  }

  if (!Number.isInteger(quantityToAdd) || quantityToAdd <= 0) {
    throw new Error('QUANTIDADE_INVALIDA: A quantidade deve ser ao menos 1 unidade.');
  }

  const existingIndex = currentCart.findIndex(
    (item) => item.variantId === selection.selectedVariant!.id
  );

  const currentQty = existingIndex >= 0 ? currentCart[existingIndex].quantity : 0;
  const targetQty = currentQty + quantityToAdd;

  if (targetQty > selection.commercialState.maxPurchaseQuantity) {
    throw new Error(
      `LIMITE_ESTOQUE_EXCEDIDO: A variação ${selection.selectedVariant.skuCode} permite no máximo ${selection.commercialState.maxPurchaseQuantity} unidade(s).`
    );
  }

  // Preserva na linha do carrinho apenas a imagem específica da cor escolhida (nunca imagem de outra cor)
  const specificImageUrl = selection.galleryResolution.hasSpecificImages
    ? selection.galleryResolution.primaryImage?.url ?? null
    : null;

  const snapshot: CartItemSnapshot = {
    variantId: selection.selectedVariant.id,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    skuCode: selection.selectedVariant.skuCode,
    colorName: selection.selectedVariant.colorName,
    modelName: selection.selectedVariant.modelName,
    sizeLabel: selection.selectedVariant.sizeLabel,
    supplyMode: selection.commercialState.supplyMode,
    prepDays: selection.commercialState.prepDays,
    unitPriceCents: selection.commercialState.unitPriceCents,
    quantity: targetQty,
    maxPurchaseQuantity: selection.commercialState.maxPurchaseQuantity,
    specificImageUrl,
  };

  if (existingIndex >= 0) {
    const next = [...currentCart];
    next[existingIndex] = snapshot;
    return next;
  }

  return [...currentCart, snapshot];
}
