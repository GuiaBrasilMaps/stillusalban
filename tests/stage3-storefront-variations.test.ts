import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  attachVariantImageWithAudit,
  createProductWithAudit,
  createVariantWithAudit,
} from '../src/lib/catalog';
import {
  addOrUpdateCartItem,
  calculatePixPriceCents,
  CartItemSnapshot,
  filterAndSortCatalogProducts,
  resolveProductVariationSelection,
} from '../src/lib/storefront';

const prisma = new PrismaClient();

async function main() {
  console.log('=== [STILLUS ALBAN] Iniciando Testes Automatizados da Etapa 3 ===');

  const initialProductCount = await prisma.product.count();
  const [catBolsas, catCalcados] = await Promise.all([
    prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } }),
    prisma.category.findUniqueOrThrow({ where: { slug: 'calcados' } }),
  ]);

  const prodBolsa = await createProductWithAudit(
    {
      categoryId: catBolsas.id,
      name: 'Bolsa Clássica Stillus',
      slug: `bolsa-classica-etapa3-${Date.now()}`,
      shortDescription: 'Bolsa estruturada em couro preto',
      basePriceCents: 48000,
      status: 'ACTIVE',
      isFeatured: true,
      weightKg: 0.7,
      heightCm: 20,
      widthCm: 28,
      lengthCm: 35,
    },
    null,
    prisma
  );

  const prodSapato = await createProductWithAudit(
    {
      categoryId: catCalcados.id,
      name: 'Scarpin Alban Lux',
      slug: `scarpin-alban-etapa3-${Date.now()}`,
      shortDescription: 'Scarpin salto fino preto e dourado',
      basePriceCents: 35000,
      status: 'ACTIVE',
      isFeatured: true,
      weightKg: 0.8,
      heightCm: 14,
      widthCm: 22,
      lengthCm: 32,
    },
    null,
    prisma
  );

  try {
    // SKUs da Bolsa: Somente Em Estoque (Preto Único - 3 un.)
    await createVariantWithAudit(
      {
        productId: prodBolsa.id,
        skuCode: `SKU-BOL-PRE-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Alça Dupla',
        sizeLabel: 'Único',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 3,
        isActive: true,
      },
      null,
      prisma
    );

    // SKUs do Scarpin:
    // - Preto 35 (Em Estoque: 2 un.)
    // - Preto 36 (Esgotado: 0 un.)
    // - Dourado 37 (Sob Encomenda Prazo Confirmado: 6 dias úteis, R$ 380,00)
    // - Vinho 38 (Sob Encomenda Prazo a Confirmar, sem foto própria)
    await createVariantWithAudit(
      {
        productId: prodSapato.id,
        skuCode: `SKU-SCA-PRE-35-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Salto Fino',
        sizeLabel: '35',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 2,
        isActive: true,
      },
      null,
      prisma
    );

    await createVariantWithAudit(
      {
        productId: prodSapato.id,
        skuCode: `SKU-SCA-PRE-36-${Date.now()}`,
        colorName: 'Preto',
        colorHex: '#0A0A0A',
        modelName: 'Salto Fino',
        sizeLabel: '36',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 0, // Esgotado
        isActive: true,
      },
      null,
      prisma
    );

    await createVariantWithAudit(
      {
        productId: prodSapato.id,
        skuCode: `SKU-SCA-DOU-37-${Date.now()}`,
        colorName: 'Dourado',
        colorHex: '#D4AF37',
        modelName: 'Salto Fino',
        sizeLabel: '37',
        priceOverrideCents: 38000,
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 6,
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    await createVariantWithAudit(
      {
        productId: prodSapato.id,
        skuCode: `SKU-SCA-VIN-38-${Date.now()}`,
        colorName: 'Vinho',
        modelName: 'Salto Fino',
        sizeLabel: '38',
        supplyMode: 'MADE_TO_ORDER_TBD_LEAD',
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    // Anexa fotos apenas para Preto e Dourado no Scarpin (Vinho fica sem foto específica)
    await attachVariantImageWithAudit(
      {
        productId: prodSapato.id,
        colorName: 'Preto',
        modelName: 'Salto Fino',
        url: '/uploads/scarpin-preto.jpg',
        altText: 'Scarpin na cor preta',
        displayOrder: 0,
        isPrimary: true,
      },
      null,
      prisma
    );

    await attachVariantImageWithAudit(
      {
        productId: prodSapato.id,
        colorName: 'Dourado',
        modelName: 'Salto Fino',
        url: '/uploads/scarpin-dourado.jpg',
        altText: 'Scarpin na cor dourada',
        displayOrder: 0,
        isPrimary: true,
      },
      null,
      prisma
    );

    const allProducts = await prisma.product.findMany({
      where: { id: { in: [prodBolsa.id, prodSapato.id] } },
      include: {
        category: true,
        variants: true,
        images: true,
      },
    });

    // 1. Testes de busca, filtros e ordenação no catálogo
    const onlyCalcados = filterAndSortCatalogProducts(allProducts, {
      categorySlug: 'calcados',
    });
    assert.equal(onlyCalcados.length, 1);
    assert.equal(onlyCalcados[0].id, prodSapato.id);

    const onlyMadeToOrder = filterAndSortCatalogProducts(allProducts, {
      availability: 'MADE_TO_ORDER',
    });
    assert.equal(onlyMadeToOrder.length, 1);
    assert.equal(onlyMadeToOrder[0].id, prodSapato.id);

    const searchByTerm = filterAndSortCatalogProducts(allProducts, {
      searchQuery: 'estruturada',
    });
    assert.equal(searchByTerm.length, 1);
    assert.equal(searchByTerm[0].id, prodBolsa.id);

    const sortedLowToHigh = filterAndSortCatalogProducts(allProducts, {
      sortBy: 'menor_preco',
    });
    assert.equal(sortedLowToHigh[0].id, prodSapato.id);
    assert.equal(sortedLowToHigh[1].id, prodBolsa.id);
    console.log('✓ [Teste 1] Filtros de categoria, modalidade, busca textual e ordenação aprovados.');

    // 2. Testes da matriz de variações (Cor, Modelo, Tamanho) e bloqueio de incompatibilidades
    const sapatoRel = allProducts.find((p) => p.id === prodSapato.id)!;

    // Seleciona Cor "Preto": tamanhos 35 e 36 devem ser compatíveis; 37 e 38 devem ser incompatíveis
    const selPreto35 = resolveProductVariationSelection({
      product: sapatoRel,
      variants: sapatoRel.variants,
      images: sapatoRel.images,
      selectedColorName: 'Preto',
      selectedSizeLabel: '35',
      pixDiscountPercent: 10,
    });

    assert.equal(selPreto35.selectedColorName, 'Preto');
    assert.equal(selPreto35.selectedSizeLabel, '35');
    assert.equal(selPreto35.galleryResolution.hasSpecificImages, true);
    assert.equal(selPreto35.galleryResolution.primaryImage?.url, '/uploads/scarpin-preto.jpg');
    assert.equal(selPreto35.pixPriceCents, calculatePixPriceCents(35000, 10)); // 31500

    const size37InPreto = selPreto35.sizeOptionsForColorAndModel.find((s) => s.sizeLabel === '37')!;
    assert.equal(
      size37InPreto.isCompatibleWithColorAndModel,
      false,
      'Tamanho 37 não existe na cor Preta e deve estar demarcado como incompatível'
    );

    // Ao trocar a cor para "Dourado" mantendo o tamanho anterior "35" (incompatível com Dourado),
    // o seletor deve migrar automaticamente para o tamanho compatível "37" e trocar foto, preço e prazo!
    const selDourado = resolveProductVariationSelection({
      product: sapatoRel,
      variants: sapatoRel.variants,
      images: sapatoRel.images,
      selectedColorName: 'Dourado',
      selectedSizeLabel: '35', // Incompatível com Dourado -> deve resolver para '37'
      pixDiscountPercent: 10,
    });

    assert.equal(selDourado.selectedColorName, 'Dourado');
    assert.equal(
      selDourado.selectedSizeLabel,
      '37',
      'Deve impedir combinação incompatível (Dourado + 35) e selecionar a combinação válida (Dourado + 37)'
    );
    assert.equal(selDourado.commercialState?.unitPriceCents, 38000);
    assert.equal(selDourado.commercialState?.prepDays, 6);
    assert.equal(selDourado.galleryResolution.primaryImage?.url, '/uploads/scarpin-dourado.jpg');

    // Ao selecionar a cor "Vinho" (sem foto própria), não deve exibir foto preta nem dourada como primaryImage
    const selVinho = resolveProductVariationSelection({
      product: sapatoRel,
      variants: sapatoRel.variants,
      images: sapatoRel.images,
      selectedColorName: 'Vinho',
      pixDiscountPercent: 10,
    });

    assert.equal(selVinho.selectedColorName, 'Vinho');
    assert.equal(selVinho.selectedSizeLabel, '38');
    assert.equal(selVinho.galleryResolution.hasSpecificImages, false);
    assert.equal(selVinho.galleryResolution.primaryImage, null);
    assert.match(selVinho.galleryResolution.missingImageNotice || '', /Vinho/);
    console.log(
      '✓ [Teste 2] Matriz de variações, bloqueio de tamanhos incompatíveis e sincronização de galeria aprovados.'
    );

    // 3. Testes de preservação exata da variação no carrinho e limites de estoque
    let cart: CartItemSnapshot[] = [];

    // Adiciona 2 unidades de Preto 35 (Em Estoque: máx 2)
    cart = addOrUpdateCartItem(cart, selPreto35, sapatoRel, 2);
    assert.equal(cart.length, 1);
    assert.equal(cart[0].colorName, 'Preto');
    assert.equal(cart[0].sizeLabel, '35');
    assert.equal(cart[0].quantity, 2);
    assert.equal(cart[0].specificImageUrl, '/uploads/scarpin-preto.jpg');

    // Tenta adicionar +1 unidade de Preto 35 (ultrapassando saldo 2) -> deve lançar erro
    assert.throws(
      () => addOrUpdateCartItem(cart, selPreto35, sapatoRel, 1),
      /LIMITE_ESTOQUE_EXCEDIDO/,
      'Deve bloquear adição acima do saldo disponível em estoque próprio'
    );

    // Tenta adicionar Preto 36 (Esgotado) -> deve lançar erro
    const selPreto36Esgotado = resolveProductVariationSelection({
      product: sapatoRel,
      variants: sapatoRel.variants,
      images: sapatoRel.images,
      selectedColorName: 'Preto',
      selectedSizeLabel: '36',
    });
    assert.equal(selPreto36Esgotado.commercialState?.canPurchase, false);
    assert.throws(
      () => addOrUpdateCartItem(cart, selPreto36Esgotado, sapatoRel, 1),
      /VARIACAO_INDISPONIVEL/,
      'Deve bloquear adição de variação esgotada'
    );

    // Combina no mesmo carrinho 1 unidade de Dourado 37 (Sob Encomenda: 6 dias) e 1 de Vinho 38 (Sem foto própria)
    cart = addOrUpdateCartItem(cart, selDourado, sapatoRel, 1);
    cart = addOrUpdateCartItem(cart, selVinho, sapatoRel, 1);
    assert.equal(cart.length, 3);
    assert.equal(cart[1].supplyMode, 'MADE_TO_ORDER_CONFIRMED_LEAD');
    assert.equal(cart[1].prepDays, 6);
    assert.equal(
      cart[2].specificImageUrl,
      null,
      'Item sem foto específica da cor escolhida deve preservar specificImageUrl = null no carrinho'
    );
    console.log(
      '✓ [Teste 3] Preservação exata de SKU no carrinho misto e bloqueio de excesso de estoque aprovados.'
    );
  } finally {
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: { in: [prodBolsa.id, prodSapato.id] } } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [prodBolsa.id, prodSapato.id] } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        action: {
          in: ['PRODUCT_CREATED', 'VARIANT_CREATED', 'PRODUCT_IMAGE_ATTACHED'],
        },
        actorUserId: null,
      },
    });
  }

  const remainingProducts = await prisma.product.count();
  assert.equal(
    remainingProducts,
    initialProductCount,
    'A quantidade de produtos no banco deve retornar exatamente ao estado anterior após o teste.'
  );
  console.log('=== [STILLUS ALBAN] Todos os testes da Etapa 3 passaram com sucesso! ===');
}

main()
  .catch((err) => {
    console.error('FALHA NOS TESTES DA ETAPA 3:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
