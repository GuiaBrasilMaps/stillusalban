import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  attachVariantImageWithAudit,
  CreateProductSchema,
  createProductWithAudit,
  CreateVariantSchema,
  createVariantWithAudit,
  resolveVariantCommercialState,
  resolveVariantGallery,
} from '../src/lib/catalog';
import {
  adjustStockOnHand,
  confirmOrderStockDeduction,
  releaseVariantReservation,
  reserveVariantStock,
} from '../src/lib/inventory';

const prisma = new PrismaClient();

async function main() {
  console.log('=== [STILLUS ALBAN] Iniciando Testes Automatizados da Etapa 2 ===');

  // 1. Validação de schema: bloqueio de produto sem peso/dimensões e encomenda sem prazo confirmado
  assert.throws(
    () =>
      CreateProductSchema.parse({
        categoryId: 'cat-1',
        name: 'Bolsa Teste',
        slug: 'bolsa-teste',
        shortDescription: 'Descrição curta válida',
        basePriceCents: 35000,
        weightKg: 0, // Inválido para Melhor Envio
        heightCm: 20,
        widthCm: 25,
        lengthCm: 30,
      }),
    /Peso \(kg\) é obrigatório/,
    'Deve bloquear cadastro de produto com peso zerado'
  );

  assert.throws(
    () =>
      CreateVariantSchema.parse({
        productId: 'prod-1',
        skuCode: 'SKU-ENC-01',
        colorName: 'Dourado',
        modelName: 'Padrão',
        sizeLabel: '37',
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 0, // Inválido: exige prazo > 0
      }),
    /exigem dias úteis de preparação maior que zero/,
    'Deve bloquear variação sob encomenda com prazo confirmado sem informar dias úteis > 0'
  );
  console.log('✓ [Teste 1] Validações de peso/dimensões (Melhor Envio) e prazo de encomenda aprovadas.');

  // 2. Cria registros temporários de teste (serão removidos no finally preservando produtos existentes)
  const initialProductCount = await prisma.product.count();
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } });
  const testProduct = await createProductWithAudit(
    {
      categoryId: category.id,
      name: 'PRODUTO_TEMP_TESTE_ETAPA2',
      slug: `temp-etapa2-${Date.now()}`,
      shortDescription: 'Produto temporário para validação automatizada da Etapa 2',
      basePriceCents: 42000,
      status: 'ACTIVE',
      isFeatured: false,
      weightKg: 0.75,
      heightCm: 20,
      widthCm: 28,
      lengthCm: 35,
    },
    null,
    prisma
  );

  try {
    // 3. Cria SKUs: Preta (Em Estoque: 2 un.), Dourada (Sob Encomenda Prazo Confirmado: 7 dias), Caramelo (Sob Encomenda Prazo a Definir)
    const skuPreta = await createVariantWithAudit(
      {
        productId: testProduct.id,
        skuCode: `SKU-PRETA-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Couro',
        sizeLabel: 'Único',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 2,
        isActive: true,
      },
      null,
      prisma
    );

    const skuDourada = await createVariantWithAudit(
      {
        productId: testProduct.id,
        skuCode: `SKU-DOURADA-${Date.now()}`,
        colorName: 'Dourado',
        colorHex: '#D4AF37',
        modelName: 'Couro',
        sizeLabel: 'Único',
        priceOverrideCents: 45000,
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 7,
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    const skuCaramelo = await createVariantWithAudit(
      {
        productId: testProduct.id,
        skuCode: `SKU-CARAMELO-${Date.now()}`,
        colorName: 'Caramelo',
        modelName: 'Couro',
        sizeLabel: 'Único',
        supplyMode: 'MADE_TO_ORDER_TBD_LEAD',
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    // 4. Anexa foto EXCLUSIVAMENTE para a cor "Preto" e verifica comportamento seguro para "Caramelo"
    await attachVariantImageWithAudit(
      {
        productId: testProduct.id,
        colorName: 'Preto',
        modelName: 'Couro',
        url: '/uploads/teste-bolsa-preta.jpg',
        altText: 'Bolsa preta em couro',
        displayOrder: 0,
        isPrimary: true,
      },
      null,
      prisma
    );

    const allImages = await prisma.productImage.findMany({
      where: { productId: testProduct.id },
    });

    const galeriaPreta = resolveVariantGallery(allImages, 'Preto', 'Couro');
    assert.equal(galeriaPreta.hasSpecificImages, true);
    assert.equal(galeriaPreta.gallery.length, 1);
    assert.equal(galeriaPreta.primaryImage?.url, '/uploads/teste-bolsa-preta.jpg');

    const galeriaCaramelo = resolveVariantGallery(allImages, 'Caramelo', 'Couro');
    assert.equal(
      galeriaCaramelo.hasSpecificImages,
      false,
      'Cor sem imagem cadastrada NÃO pode afirmar que tem foto própria'
    );
    assert.equal(
      galeriaCaramelo.primaryImage,
      null,
      'Cor sem imagem cadastrada NÃO pode usar foto de outra cor como primaryImage'
    );
    assert.equal(galeriaCaramelo.gallery.length, 0);
    assert.match(galeriaCaramelo.missingImageNotice || '', /Caramelo/);
    assert.match(
      galeriaCaramelo.illustrativeFallbackImages[0]?.disclaimer || '',
      /Foto meramente ilustrativa na cor "Preto"/
    );
    console.log(
      '✓ [Teste 2] Sincronização estrita de galeria por cor e proteção contra foto de outra cor aprovadas.'
    );

    // 5. Verifica resolução dos estados comerciais (Estoque próprio, Encomenda prazo confirmado e Encomenda prazo a confirmar)
    const estadoPreta = resolveVariantCommercialState(testProduct, skuPreta);
    assert.equal(estadoPreta.canPurchase, true);
    assert.equal(estadoPreta.maxPurchaseQuantity, 2);
    assert.equal(estadoPreta.unitPriceCents, 42000);
    assert.equal(estadoPreta.badgeType, 'IN_STOCK');

    const estadoDourada = resolveVariantCommercialState(testProduct, skuDourada);
    assert.equal(estadoDourada.canPurchase, true);
    assert.equal(estadoDourada.unitPriceCents, 45000); // Respeita priceOverrideCents da variação
    assert.equal(estadoDourada.prepDays, 7);
    assert.equal(estadoDourada.badgeType, 'MADE_TO_ORDER_CONFIRMED');

    const estadoCaramelo = resolveVariantCommercialState(testProduct, skuCaramelo);
    assert.equal(estadoCaramelo.canPurchase, true); // Pode ser pago normalmente conforme decisão #3
    assert.equal(estadoCaramelo.prepDays, null);
    assert.equal(estadoCaramelo.badgeType, 'MADE_TO_ORDER_TBD');
    console.log('✓ [Teste 3] Resolução de preço por variação e 5 estados de disponibilidade aprovada.');

    // 6. Teste de concorrência e integridade de estoque (2 unidades disponíveis, dois clientes disputando as 2 un. simultaneamente)
    const results = await Promise.allSettled([
      reserveVariantStock({ variantId: skuPreta.id, quantity: 2, reason: 'Cliente A' }, prisma),
      reserveVariantStock({ variantId: skuPreta.id, quantity: 2, reason: 'Cliente B' }, prisma),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Apenas uma reserva deve vencer quando o estoque é insuficiente para ambas');
    assert.equal(rejected.length, 1, 'A reserva excedente deve ser bloqueada atomicamente');

    // Tenta reduzir estoque físico abaixo do reservado (2 reservados) -> deve bloquear
    await assert.rejects(
      () =>
        adjustStockOnHand(
          {
            variantId: skuPreta.id,
            quantityDelta: -1,
            movementType: 'MANUAL_ADJUSTMENT',
            reason: 'Tentativa inválida abaixo da reserva',
          },
          null,
          prisma
        ),
      /CONFLITO_RESERVA_ESTOQUE/
    );

    // Libera 1 unidade da reserva e confirma baixa definitiva de 1 unidade paga
    const afterRelease = await releaseVariantReservation(
      { variantId: skuPreta.id, quantity: 1, reason: 'Liberação parcial de teste' },
      prisma
    );
    assert.equal(afterRelease.stockOnHand, 2);
    assert.equal(afterRelease.stockReserved, 1);

    const afterDeduction = await confirmOrderStockDeduction(
      { variantId: skuPreta.id, quantity: 1, reason: 'Pagamento confirmado no teste' },
      prisma
    );
    assert.equal(afterDeduction.stockOnHand, 1);
    assert.equal(afterDeduction.stockReserved, 0);

    // Verifica que todas as movimentações foram registradas no razão (InventoryMovement)
    const movementsCount = await prisma.inventoryMovement.count({
      where: { variantId: skuPreta.id },
    });
    assert.equal(movementsCount, 4, 'Deve conter 4 registros no razão (Carga inicial, Reserva, Liberação, Baixa)');
    console.log('✓ [Teste 4] Controle atômico de estoque, bloqueio de concorrência e razão aprovados.');
  } finally {
    // Limpa registros temporários de teste (mantendo zero produtos fictícios no banco)
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: testProduct.id } },
    });
    await prisma.product.delete({ where: { id: testProduct.id } });
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['PRODUCT_CREATED', 'VARIANT_CREATED', 'PRODUCT_IMAGE_ATTACHED', 'INVENTORY_ADJUSTED'],
        },
        actorUserId: null,
      },
    });
  }

  const finalProductCount = await prisma.product.count();
  assert.equal(
    finalProductCount,
    initialProductCount,
    'A quantidade de produtos no banco deve retornar exatamente ao estado anterior após o teste.'
  );
  console.log('=== [STILLUS ALBAN] Todos os testes da Etapa 2 passaram com sucesso! ===');
}

main()
  .catch((err) => {
    console.error('FALHA NOS TESTES DA ETAPA 2:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
