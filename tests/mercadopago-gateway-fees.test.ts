import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProductMarginMetrics,
  calculateSalePriceFromMarkup,
  evaluatePurchaseListMetrics,
} from '../src/lib/purchasing-strategy';
import { getIntegrationDiagnostics } from '../src/lib/integrations-status';
import { isMercadoPagoTestMode, getMercadoPagoPublicKey } from '../src/lib/mercadopago';

test('Mercado Pago Gateway — Diagnóstico e Detecção de Modo', () => {
  assert.equal(isMercadoPagoTestMode(), true);
  assert.equal(getMercadoPagoPublicKey(), 'TEST-fe169180-300c-4a37-aa8c-43b82a9b9f51');

  const diag = getIntegrationDiagnostics();
  assert.equal(diag.mercadoPago.publicKeyConfigured, true);
  assert.equal(diag.mercadoPago.accessTokenConfigured, true);
  assert.equal(diag.mercadoPago.isSandbox, true);
  assert.equal(diag.mercadoPago.status, 'PRONTO_TESTE');
});

test('Mercado Pago Gateway — Cálculo de Preço com Cobertura de Taxa do Cartão', () => {
  const costCents = 10000; // R$ 100,00
  const markupPercent = 100; // 100% -> Preço bruto: R$ 200,00
  const cardFeePercent = 3.99; // 3.99% taxa de cartão MP

  // Preço que cobre os 3.99% para sobrar exatamente R$ 200,00 líquidos:
  // 20000 / (1 - 0.0399) = 20831.16 -> 20831 centavos (R$ 208,31)
  const priceWithFeeCoverage = calculateSalePriceFromMarkup(costCents, markupPercent, {
    coverGatewayFee: true,
    gatewayFeePercent: cardFeePercent,
  });

  assert.equal(priceWithFeeCoverage, 20831);
});

test('Mercado Pago Gateway — Métricas de Lucro Líquido Deduzindo Taxas Reais', () => {
  const costCents = 15000; // R$ 150,00
  const salePriceCents = 33000; // R$ 330,00 (Markup 120%)
  const pixDiscountPercent = 10; // -10% PIX -> R$ 297,00
  const gatewayPixFeePercent = 0.99; // 0.99% taxa PIX
  const gatewayCardFeePercent = 3.99; // 3.99% taxa Cartão

  const metrics = calculateProductMarginMetrics({
    costCents,
    salePriceCents,
    pixDiscountPercent,
    gatewayPixFeePercent,
    gatewayCardFeePercent,
  });

  // Cartão: Venda R$ 330,00. Taxa MP: 3.99% = R$ 13,17. Custo: R$ 150,00. Lucro Líquido = R$ 166,83
  assert.equal(metrics.cardFeeCents, 1317);
  assert.equal(metrics.cardNetProfitCents, 16683);
  assert.equal(metrics.cardNetMarginPercent, 50.6);

  // PIX: Venda R$ 297,00. Taxa MP: 0.99% = R$ 2,94. Custo: R$ 150,00. Lucro Líquido = R$ 144,06
  assert.equal(metrics.pixPriceCents, 29700);
  assert.equal(metrics.pixFeeCents, 294);
  assert.equal(metrics.pixNetProfitCents, 14406);
  assert.equal(metrics.pixNetMarginPercent, 48.5);
  assert.equal(metrics.healthStatus, 'EXCELLENT');
});

test('Mercado Pago Gateway — Avaliação de Lote de Fornecedor com Taxas Deduzidas', () => {
  const evaluation = evaluatePurchaseListMetrics({
    title: 'Lote Verão 2026',
    supplierName: 'Fábrica Premium',
    minOrderQuantity: 10,
    pixDiscountPercent: 10,
    gatewayPixFeePercent: 0.99,
    gatewayCardFeePercent: 3.99,
    items: [
      {
        id: 'item-1',
        productName: 'Scarpin Alban Gold',
        skuCode: 'SC-GLD-36',
        colorName: 'Dourado',
        sizeLabel: '36',
        quantity: 10,
        unitCostCents: 15000, // Custo total: R$ 1.500,00
        unitSalePriceCents: 33000, // Venda total Cartão: R$ 3.300,00 | PIX: R$ 2.970,00
      },
    ],
  });

  assert.equal(evaluation.totalUnits, 10);
  assert.equal(evaluation.isMinimumMet, true);
  assert.equal(evaluation.totalInvestmentCostCents, 150000);
  assert.equal(evaluation.expectedRevenueCardCents, 330000);
  assert.equal(evaluation.expectedRevenuePixCents, 297000);

  // Lucro líquido real após taxas MP:
  // Cartão: 330000 - 150000 - 13167 = 166833 centavos (R$ 1.668,33)
  // PIX: 297000 - 150000 - 2940 = 144060 centavos (R$ 1.440,60)
  assert.equal(evaluation.expectedNetProfitCardCents, 166833);
  assert.equal(evaluation.expectedNetProfitPixCents, 144060);
});
