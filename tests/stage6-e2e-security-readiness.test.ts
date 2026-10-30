import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import {
  attachVariantImageWithAudit,
  createProductWithAudit,
  createVariantWithAudit,
} from '../src/lib/catalog';
import {
  filterAndSortCatalogProducts,
  resolveProductVariationSelection,
} from '../src/lib/storefront';
import {
  adminUpdateOrderOperationalStatus,
  createOrderWithIntegrity,
  processInfinitePayWebhook,
} from '../src/lib/orders';
import {
  bootstrapFirstAdminOwner,
  evaluateOperationalReadiness,
} from '../src/lib/operational-readiness';
import { assertAuthorizedRole, signAdminSession, verifyAdminSession } from '../src/lib/auth';
import {
  calculateProductMarginMetrics,
  calculateSalePriceFromMarkup,
  evaluatePurchaseListMetrics,
} from '../src/lib/purchasing-strategy';
import { buildLocalSmartCatalogSuggestion } from '../src/app/api/admin/ai-assistant/route';

const VALID_CPF = '52998224725';

test('Etapa 6.1 — Jornada End-to-End Completa (Bootstrap Admin -> Catálogo -> Variação/Galeria -> Sacola Mista -> Frete Regional -> Pedido -> Webhook InfinitePay -> Rastreio -> Entrega)', async () => {
  process.env.AUTH_JWT_SECRET =
    process.env.AUTH_JWT_SECRET || 'stillus-alban-e2e-jwt-secret-key-2026-secure';
  const bootstrapSecret = 'bootstrap-secret-stillus-2026';
  const webhookSecret = 'webhook-secret-stillus-2026';

  let createdAdminId: string | null = null;
  let createdProductId: string | null = null;
  let createdOrderId: string | null = null;
  let createdCustomerId: string | null = null;

  try {
    // 1. Verifica ou provisiona administrador (ADMIN_OWNER) preservando conta real caso já exista
    const existingAdmin = await prisma.user.findFirst({ where: { isActive: true } });
    let admin = existingAdmin;

    if (!admin) {
      const bootstrapped = await bootstrapFirstAdminOwner(
        {
          fullName: 'Responsável STILLUS ALBAN',
          email: 'proprietario@stillusalban.com.br',
          passwordPlain: 'SenhaSegura@2026!',
          bootstrapToken: bootstrapSecret,
        },
        { client: prisma, expectedTokenOverride: bootstrapSecret }
      );
      createdAdminId = bootstrapped.id;
      admin = await prisma.user.findUniqueOrThrow({ where: { id: bootstrapped.id } });
    }
    assert.equal(admin.role, 'ADMIN_OWNER');

    // Tentativa de executar bootstrap quando já existe administrador deve ser bloqueada (anti-takeover)
    await assert.rejects(
      async () => {
        await bootstrapFirstAdminOwner(
          {
            fullName: 'Invasor',
            email: 'invasor@teste.com',
            passwordPlain: 'SenhaForte123!',
            bootstrapToken: bootstrapSecret,
          },
          { client: prisma, expectedTokenOverride: bootstrapSecret }
        );
      },
      /BOOTSTRAP_JA_REALIZADO/
    );

    // 2. Autenticação JWT e RBAC server-side
    const token = signAdminSession({
      userId: admin.id,
      email: admin.email,
      role: 'ADMIN_OWNER',
    });
    const decoded = verifyAdminSession(token);
    assertAuthorizedRole(decoded, ['ADMIN_OWNER']);

    // 3. Cadastro administrativo de Produto + 2 Variações (1 em Estoque Próprio + 1 Sob Encomenda) + Foto vinculada à Cor
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } });
    const product = await createProductWithAudit(
      {
        categoryId: category.id,
        name: 'Bolsa E2E Stillus Alban',
        slug: `bolsa-e2e-${Date.now()}`,
        shortDescription: 'Jornada E2E completa validada',
        basePriceCents: 40000, // R$ 400,00
        status: 'ACTIVE',
        isFeatured: true,
        weightKg: 0.75,
        heightCm: 22,
        widthCm: 30,
        lengthCm: 15,
      },
      admin.id,
      prisma
    );
    createdProductId = product.id;

    const varPreta = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-E2E-PRETA-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Matelassê',
        sizeLabel: 'M',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 3,
        isActive: true,
      },
      admin.id,
      prisma
    );

    const varDourada = await createVariantWithAudit(
      {
        productId: product.id,
        skuCode: `SKU-E2E-DOURADA-${Date.now()}`,
        colorName: 'Dourado',
        colorHex: '#D4AF37',
        modelName: 'Festa',
        sizeLabel: 'P',
        priceOverrideCents: 50000, // R$ 500,00
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 6,
        initialStockOnHand: 0,
        isActive: true,
      },
      admin.id,
      prisma
    );

    await attachVariantImageWithAudit(
      {
        productId: product.id,
        colorName: 'Preto',
        modelName: 'Matelassê',
        url: '/uploads/bolsa-preta-e2e.jpg',
        altText: 'Bolsa Preta Matelassê',
        displayOrder: 0,
        isPrimary: true,
      },
      admin.id,
      prisma
    );

    // 4. Vitrine Pública e Matriz de Variações (sincronização estrita de galeria por cor)
    const rawCatalog = await prisma.product.findMany({
      where: { id: product.id },
      include: { category: true, variants: true, images: true },
    });
    const cards = filterAndSortCatalogProducts(rawCatalog, {});
    assert.equal(cards.length, 1);

    const matrixPreta = resolveProductVariationSelection({
      product: rawCatalog[0],
      variants: rawCatalog[0].variants,
      images: rawCatalog[0].images,
      selectedColorName: 'Preto',
      selectedModelName: 'Matelassê',
      selectedSizeLabel: 'M',
      pixDiscountPercent: 10,
    });
    assert.equal(matrixPreta.galleryResolution.hasSpecificImages, true);
    assert.equal(matrixPreta.selectedVariant?.skuCode, varPreta.skuCode);

    const matrixDourada = resolveProductVariationSelection({
      product: rawCatalog[0],
      variants: rawCatalog[0].variants,
      images: rawCatalog[0].images,
      selectedColorName: 'Dourado',
      selectedModelName: 'Festa',
      selectedSizeLabel: 'P',
      pixDiscountPercent: 10,
    });
    assert.equal(
      matrixDourada.galleryResolution.hasSpecificImages,
      false,
      'Cor Dourado sem foto própria jamais deve exibir a foto da cor Preto'
    );

    // 5. Checkout no Site com Sacola Mista (Remessa Única) para Venda Nova do Imigrante (29375-000) com PIX 10% OFF
    const { order } = await createOrderWithIntegrity(
      {
        channel: 'SITE_CHECKOUT',
        idempotencyKey: `idem-e2e-${Date.now()}`,
        agreedToMadeToOrderTerms: true,
        items: [
          { variantId: varPreta.id, quantity: 1 }, // R$ 400,00
          { variantId: varDourada.id, quantity: 1 }, // R$ 500,00 -> Subtotal R$ 900,00
        ],
        destinationCep: '29375-000', // Venda Nova do Imigrante (Entrega a Combinar)
        paymentMethod: 'PIX',
        installments: 1,
        customer: {
          fullName: 'Helena Cliente E2E',
          cpf: VALID_CPF,
          email: 'helena@e2e.com.br',
          phoneWhatsapp: '27999887766',
        },
        address: {
          cep: '29375-000',
          street: 'Av. Ângelo Altoé',
          number: '500',
          neighborhood: 'Centro',
          city: 'Venda Nova do Imigrante',
          state: 'ES',
        },
      },
      { client: prisma }
    );

    createdOrderId = order.id;
    createdCustomerId = order.customerId;

    assert.equal(order.subtotalCents, 90000);
    assert.equal(order.discountCents, 9000); // 10% PIX
    assert.equal(order.totalCents, 81000);
    assert.equal(order.hasMadeToOrderItems, true);
    assert.equal(order.maxPrepDays, 6);
    assert.equal(order.orderStatus, 'AGUARDANDO_PAGAMENTO');

    // 6. Webhook InfinitePay autenticado confirma pagamento e baixa estoque da variação Preta (3 -> 2)
    const whBody = JSON.stringify({
      event_id: `evt-e2e-${order.orderNumber}`,
      order_nsu: order.orderNumber,
      transaction_nsu: `nsu-e2e-${Date.now()}`,
      paid_amount_cents: 81000,
      status: 'approved',
      payment_method: 'pix',
    });
    const sig = crypto.createHmac('sha256', webhookSecret).update(whBody).digest('hex');

    await processInfinitePayWebhook(
      {
        rawBody: whBody,
        signatureHeader: sig,
        webhookSecretOverride: webhookSecret,
      },
      prisma
    );

    const varPretaAfterPaid = await prisma.productVariant.findUniqueOrThrow({
      where: { id: varPreta.id },
    });
    assert.equal(varPretaAfterPaid.stockOnHand, 2);
    assert.equal(varPretaAfterPaid.stockReserved, 0);

    // 7. Admin atualiza pedido para ENVIADO com código de rastreio e depois para ENTREGUE
    const shippedOrder = await adminUpdateOrderOperationalStatus(
      {
        orderId: order.id,
        adminUserId: admin.id,
        orderStatus: 'ENVIADO',
        trackingCode: 'SA-ENTR-COMBINADA-VN01',
      },
      prisma
    );
    assert.equal(shippedOrder.orderStatus, 'ENVIADO');
    assert.equal(shippedOrder.shipping?.trackingCode, 'SA-ENTR-COMBINADA-VN01');

    const deliveredOrder = await adminUpdateOrderOperationalStatus(
      {
        orderId: order.id,
        adminUserId: admin.id,
        orderStatus: 'ENTREGUE',
      },
      prisma
    );
    assert.equal(deliveredOrder.orderStatus, 'ENTREGUE');
    assert.equal(deliveredOrder.paymentStatus, 'CONFIRMADO');
  } finally {
    await prisma.paymentWebhookEvent.deleteMany({});
    if (createdProductId) {
      await prisma.inventoryMovement.deleteMany({
        where: { variant: { productId: createdProductId } },
      });
    }
    if (createdOrderId) {
      await prisma.order.deleteMany({ where: { id: createdOrderId } });
    }
    if (createdCustomerId) {
      await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
    }
    const entityIdsToClean = [createdProductId, createdOrderId, createdAdminId].filter(
      (id): id is string => Boolean(id)
    );
    if (entityIdsToClean.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entityId: { in: entityIdsToClean } },
      });
    }
    if (createdProductId) {
      await prisma.product.deleteMany({ where: { id: createdProductId } });
    }
    if (createdAdminId) {
      await prisma.user.deleteMany({ where: { id: createdAdminId } });
    }
  }
});

test('Etapa 6.2 — Prontidão Operacional e Integridade do Banco de Dados', async () => {
  const report = await evaluateOperationalReadiness(prisma);

  assert.equal(report.databaseConnected, true);
  assert.equal(report.storeSettingsConfigured, true);
  assert.equal(report.originCep, '29260-000');
  assert.equal(report.pixDiscountPercent, 10);
  assert.equal(report.maxInstallments, 12);
  assert.equal(report.stockReservationMinutes, 30);
  assert.equal(report.categoriesCount, 3);
  assert.deepEqual(report.activeNearbyMunicipalities, [
    'Domingos Martins',
    'Marechal Floriano',
    'Venda Nova do Imigrante',
  ]);
  assert.equal(report.integrations.whatsapp.status, 'PRONTO');
});

test('Etapa 6.3 — Estratégia de Custo, Markup Automático (120%), Lista de Pedido ao Fornecedor e Assistente IA', async () => {
  // 1. Markup de 120% sobre custo de R$ 150,00 (15000 centavos) -> R$ 330,00 (33000 centavos)
  const salePriceCents = calculateSalePriceFromMarkup(15000, 120);
  assert.equal(salePriceCents, 33000);

  // 2. Indicadores de Margem no Cartão vs PIX (-10% OFF)
  const margin = calculateProductMarginMetrics({
    costCents: 15000,
    salePriceCents: 33000,
    pixDiscountPercent: 10,
  });
  assert.equal(margin.appliedMarkupPercent, 120);
  assert.equal(margin.cardProfitCents, 18000); // R$ 180,00 de lucro bruto no cartão
  assert.equal(margin.pixPriceCents, 29700); // R$ 297,00 no PIX
  assert.equal(margin.pixProfitCents, 14700); // R$ 147,00 de lucro líquido no PIX
  assert.equal(margin.healthStatus, 'EXCELLENT');

  // 3. Simulador de Lista de Pedido ao Fornecedor com Regra de Quantidade Mínima (12 peças)
  const listEval = evaluatePurchaseListMetrics({
    title: 'Pedido Fornecedor Teste',
    supplierName: 'Atacado Sul',
    minOrderQuantity: 12,
    pixDiscountPercent: 10,
    items: [
      {
        id: 'item-1',
        productName: 'Sandália Salto Bloco Aurum',
        skuCode: 'SA-SND-GLD-36',
        colorName: 'Dourado',
        sizeLabel: '36',
        quantity: 8,
        unitCostCents: 13000,
        unitSalePriceCents: 28600,
      },
    ],
  });
  assert.equal(listEval.totalUnits, 8);
  assert.equal(listEval.isMinimumMet, false);
  assert.equal(listEval.remainingToMinimum, 4);
  assert.equal(listEval.totalInvestmentCostCents, 104000); // R$ 1.040,00
  assert.ok(listEval.breakEvenUnitsPix > 0 && listEval.breakEvenUnitsPix <= 5);
  assert.match(listEval.whatsappOrderText, /PEDIDO DE COMPRA — STILLUS ALBAN/);

  // 4. Assistente de Cadastro Persuasivo (análise de notas brutas + markup 120%)
  const suggestion = buildLocalSmartCatalogSuggestion({
    rawNotes: 'Sandália salto bloco dourada couro legítimo, custo R$ 130, tam 35 ao 38 pronta entrega',
    markupPercent: 120,
  });
  assert.equal(suggestion.categorySlug, 'calcados');
  assert.equal(suggestion.costPriceCents, 13000);
  assert.equal(suggestion.suggestedSalePriceCents, 28600);
  assert.deepEqual(suggestion.suggestedSizes, ['35', '36', '37', '38']);
  assert.equal(suggestion.supplyMode, 'IN_STOCK');
});
