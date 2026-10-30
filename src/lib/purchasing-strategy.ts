import { formatCurrencyBRL } from './storefront';

export interface ProductMarginMetrics {
  costCents: number;
  salePriceCents: number;
  pixPriceCents: number;
  appliedMarkupPercent: number;
  cardProfitCents: number;
  cardMarginPercent: number;
  pixProfitCents: number;
  pixMarginPercent: number;
  // Métricas Líquidas Reais deduzindo taxas da operadora (Mercado Pago)
  gatewayPixFeePercent: number;
  gatewayCardFeePercent: number;
  cardFeeCents: number;
  pixFeeCents: number;
  cardNetProfitCents: number;
  cardNetMarginPercent: number;
  pixNetProfitCents: number;
  pixNetMarginPercent: number;
  healthStatus: 'EXCELLENT' | 'HEALTHY' | 'WARNING' | 'LOSS';
}

export interface PurchaseListItemSummary {
  id: string;
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  skuCode: string;
  colorName: string;
  sizeLabel: string;
  quantity: number;
  unitCostCents: number;
  unitSalePriceCents: number;
}

export interface PurchaseListEvaluation {
  totalUnits: number;
  minOrderQuantity: number;
  remainingToMinimum: number;
  isMinimumMet: boolean;
  progressPercent: number;
  totalInvestmentCostCents: number;
  expectedRevenueCardCents: number;
  expectedRevenuePixCents: number;
  expectedProfitCardCents: number;
  expectedProfitPixCents: number;
  expectedNetProfitCardCents: number;
  expectedNetProfitPixCents: number;
  averageMarginCardPercent: number;
  averageMarginPixPercent: number;
  breakEvenUnitsCard: number;
  breakEvenUnitsPix: number;
  whatsappOrderText: string;
}

/**
 * Calcula o preço de venda sugerido em centavos a partir do custo e do percentual de markup.
 * Opcionalmente, pode embutir a taxa do gateway (ex: Cartão 3.99% ou PIX 0.99%) para garantir a margem líquida.
 */
export function calculateSalePriceFromMarkup(
  costCents: number,
  markupPercent: number,
  options?: { coverGatewayFee?: boolean; gatewayFeePercent?: number }
): number {
  const safeCost = Math.max(0, Math.round(costCents));
  const safeMarkup = Math.max(0, Number(markupPercent) || 0);
  if (safeCost === 0) return 0;
  const rawPrice = safeCost * (1 + safeMarkup / 100);
  if (options?.coverGatewayFee && options.gatewayFeePercent && options.gatewayFeePercent > 0) {
    const feeRate = Math.min(0.5, options.gatewayFeePercent / 100);
    return Math.round(rawPrice / (1 - feeRate));
  }
  return Math.round(rawPrice);
}

/**
 * Calcula todos os indicadores estratégicos de lucro e margem de um produto
 * comparando venda no Cartão (preço cheio) e venda no PIX (com desconto da loja),
 * deduzindo as taxas reais do gateway (Mercado Pago).
 */
export function calculateProductMarginMetrics(params: {
  costCents: number;
  salePriceCents: number;
  pixDiscountPercent?: number;
  gatewayPixFeePercent?: number;
  gatewayCardFeePercent?: number;
}): ProductMarginMetrics {
  const costCents = Math.max(0, Math.round(params.costCents || 0));
  const salePriceCents = Math.max(0, Math.round(params.salePriceCents || 0));
  const pixDiscountPercent = Math.max(0, Math.min(90, Number(params.pixDiscountPercent ?? 10)));
  const gatewayPixFeePercent = Math.max(0, Number(params.gatewayPixFeePercent ?? 0.99));
  const gatewayCardFeePercent = Math.max(0, Number(params.gatewayCardFeePercent ?? 3.99));

  const pixDiscountCents = Math.round((salePriceCents * pixDiscountPercent) / 100);
  const pixPriceCents = Math.max(0, salePriceCents - pixDiscountCents);

  const cardFeeCents = Math.round((salePriceCents * gatewayCardFeePercent) / 100);
  const pixFeeCents = Math.round((pixPriceCents * gatewayPixFeePercent) / 100);

  const cardProfitCents = salePriceCents - costCents;
  const pixProfitCents = pixPriceCents - costCents;

  const cardNetProfitCents = cardProfitCents - cardFeeCents;
  const pixNetProfitCents = pixProfitCents - pixFeeCents;

  const appliedMarkupPercent =
    costCents > 0 ? Number((((salePriceCents - costCents) / costCents) * 100).toFixed(1)) : 0;

  const cardMarginPercent =
    salePriceCents > 0 ? Number(((cardProfitCents / salePriceCents) * 100).toFixed(1)) : 0;

  const pixMarginPercent =
    pixPriceCents > 0 ? Number(((pixProfitCents / pixPriceCents) * 100).toFixed(1)) : 0;

  const cardNetMarginPercent =
    salePriceCents > 0 ? Number(((cardNetProfitCents / salePriceCents) * 100).toFixed(1)) : 0;

  const pixNetMarginPercent =
    pixPriceCents > 0 ? Number(((pixNetProfitCents / pixPriceCents) * 100).toFixed(1)) : 0;

  let healthStatus: ProductMarginMetrics['healthStatus'] = 'HEALTHY';
  if (pixNetProfitCents <= 0 || cardNetProfitCents <= 0) {
    healthStatus = 'LOSS';
  } else if (pixNetMarginPercent < 20) {
    healthStatus = 'WARNING';
  } else if (pixNetMarginPercent >= 40) {
    healthStatus = 'EXCELLENT';
  }

  return {
    costCents,
    salePriceCents,
    pixPriceCents,
    appliedMarkupPercent,
    cardProfitCents,
    cardMarginPercent,
    pixProfitCents,
    pixMarginPercent,
    gatewayPixFeePercent,
    gatewayCardFeePercent,
    cardFeeCents,
    pixFeeCents,
    cardNetProfitCents,
    cardNetMarginPercent,
    pixNetProfitCents,
    pixNetMarginPercent,
    healthStatus,
  };
}

/**
 * Avalia uma Lista de Pedido ao Fornecedor completa:
 * - Regra de quantidade mínima do pedido (quantas peças faltam para fechar o pedido)
 * - Investimento total de compra
 * - Faturamento e lucro líquido previsto (Cartão vs PIX)
 * - Ponto de equilíbrio (Break-Even: quantas peças vendidas pagam 100% do pedido ao fornecedor)
 * - Texto formatado limpo para envio ao fornecedor via WhatsApp (sem expor preços de venda)
 */
export function evaluatePurchaseListMetrics(params: {
  title: string;
  supplierName?: string | null;
  minOrderQuantity: number;
  items: PurchaseListItemSummary[];
  pixDiscountPercent?: number;
  gatewayPixFeePercent?: number;
  gatewayCardFeePercent?: number;
}): PurchaseListEvaluation {
  const minOrderQuantity = Math.max(1, Math.round(params.minOrderQuantity || 1));
  const pixDiscountPercent = Math.max(0, Math.min(90, Number(params.pixDiscountPercent ?? 10)));
  const gatewayPixFeePercent = Math.max(0, Number(params.gatewayPixFeePercent ?? 0.99));
  const gatewayCardFeePercent = Math.max(0, Number(params.gatewayCardFeePercent ?? 3.99));

  let totalUnits = 0;
  let totalInvestmentCostCents = 0;
  let expectedRevenueCardCents = 0;
  let expectedRevenuePixCents = 0;

  for (const item of params.items) {
    const qty = Math.max(0, Math.round(item.quantity));
    const unitCost = Math.max(0, Math.round(item.unitCostCents));
    const unitSale = Math.max(0, Math.round(item.unitSalePriceCents));
    const unitPix = Math.max(0, unitSale - Math.round((unitSale * pixDiscountPercent) / 100));

    totalUnits += qty;
    totalInvestmentCostCents += unitCost * qty;
    expectedRevenueCardCents += unitSale * qty;
    expectedRevenuePixCents += unitPix * qty;
  }

  const remainingToMinimum = Math.max(0, minOrderQuantity - totalUnits);
  const isMinimumMet = totalUnits >= minOrderQuantity;
  const progressPercent = Math.min(100, Math.round((totalUnits / minOrderQuantity) * 100));

  const totalCardFeeCents = Math.round((expectedRevenueCardCents * gatewayCardFeePercent) / 100);
  const totalPixFeeCents = Math.round((expectedRevenuePixCents * gatewayPixFeePercent) / 100);

  const expectedProfitCardCents = expectedRevenueCardCents - totalInvestmentCostCents;
  const expectedProfitPixCents = expectedRevenuePixCents - totalInvestmentCostCents;

  const expectedNetProfitCardCents = expectedProfitCardCents - totalCardFeeCents;
  const expectedNetProfitPixCents = expectedProfitPixCents - totalPixFeeCents;

  const averageMarginCardPercent =
    expectedRevenueCardCents > 0
      ? Number(((expectedNetProfitCardCents / expectedRevenueCardCents) * 100).toFixed(1))
      : 0;

  const averageMarginPixPercent =
    expectedRevenuePixCents > 0
      ? Number(((expectedNetProfitPixCents / expectedRevenuePixCents) * 100).toFixed(1))
      : 0;

  const avgUnitSaleCard = totalUnits > 0 ? expectedRevenueCardCents / totalUnits : 0;
  const avgUnitSalePix = totalUnits > 0 ? expectedRevenuePixCents / totalUnits : 0;

  const breakEvenUnitsCard =
    avgUnitSaleCard > 0 ? Math.ceil(totalInvestmentCostCents / avgUnitSaleCard) : 0;
  const breakEvenUnitsPix =
    avgUnitSalePix > 0 ? Math.ceil(totalInvestmentCostCents / avgUnitSalePix) : 0;

  const lines: string[] = [
    `*PEDIDO DE COMPRA — STILLUS ALBAN*`,
    `Lista: *${params.title}*`,
  ];
  if (params.supplierName) {
    lines.push(`Fornecedor: ${params.supplierName}`);
  }
  lines.push(`Total de Peças: *${totalUnits} un.* (Regra mínima: ${minOrderQuantity} un.)`);
  lines.push(`----------------------------------`);

  params.items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. *${item.productName}* | Cor: ${item.colorName} | Tam: *${item.sizeLabel}* | SKU: ${item.skuCode} -> *${item.quantity} un.* (Custo un.: ${formatCurrencyBRL(item.unitCostCents)})`
    );
  });

  lines.push(`----------------------------------`);
  lines.push(`*Total Previsto do Pedido:* ${formatCurrencyBRL(totalInvestmentCostCents)}`);

  return {
    totalUnits,
    minOrderQuantity,
    remainingToMinimum,
    isMinimumMet,
    progressPercent,
    totalInvestmentCostCents,
    expectedRevenueCardCents,
    expectedRevenuePixCents,
    expectedProfitCardCents,
    expectedProfitPixCents,
    expectedNetProfitCardCents,
    expectedNetProfitPixCents,
    averageMarginCardPercent,
    averageMarginPixPercent,
    breakEvenUnitsCard,
    breakEvenUnitsPix,
    whatsappOrderText: lines.join('\n'),
  };
}
