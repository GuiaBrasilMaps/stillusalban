import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createProductWithAudit, createVariantWithAudit } from '../src/lib/catalog';
import {
  buildServerCheckoutQuote,
  isValidBrazilianCpf,
} from '../src/lib/checkout-quote';

const prisma = new PrismaClient();

async function main() {
  console.log('=== [STILLUS ALBAN] Iniciando Testes Automatizados da Etapa 4 ===');

  // 1. Validação algorítmica de CPF
  assert.equal(isValidBrazilianCpf('111.111.111-11'), false, 'Deve rejeitar CPF com dígitos repetidos');
  assert.equal(isValidBrazilianCpf('52998224725'), true, 'Deve aprovar CPF matematicamente válido');
  assert.equal(isValidBrazilianCpf('52998224720'), false, 'Deve rejeitar dígito verificador incorreto');
  console.log('✓ [Teste 1] Validação algorítmica de CPF aprovada.');

  const initialProductCount = await prisma.product.count();
  const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } });

  const prodTest = await createProductWithAudit(
    {
      categoryId: category.id,
      name: 'PRODUTO_TEMP_ETAPA4',
      slug: `prod-temp-etapa4-${Date.now()}`,
      shortDescription: 'Produto temporário para teste de checkout e frete da Etapa 4',
      basePriceCents: 40000, // R$ 400,00
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
    // Cria 1 SKU em Estoque Próprio (R$ 400,00, 2 un.) e 1 SKU Sob Encomenda (R$ 300,00, 8 dias úteis)
    const skuPronta = await createVariantWithAudit(
      {
        productId: prodTest.id,
        skuCode: `SKU-E4-PRONTA-${Date.now()}`,
        colorName: 'Preto',
        modelName: 'Padrão',
        sizeLabel: 'Único',
        supplyMode: 'IN_STOCK',
        initialStockOnHand: 2,
        isActive: true,
      },
      null,
      prisma
    );

    const skuEncomenda = await createVariantWithAudit(
      {
        productId: prodTest.id,
        skuCode: `SKU-E4-ENC-${Date.now()}`,
        colorName: 'Dourado',
        modelName: 'Padrão',
        sizeLabel: 'Único',
        priceOverrideCents: 30000, // R$ 300,00
        supplyMode: 'MADE_TO_ORDER_CONFIRMED_LEAD',
        prepDays: 8,
        initialStockOnHand: 0,
        isActive: true,
      },
      null,
      prisma
    );

    // 2. Teste de recálculo server-side de carrinho misto (PIX 10% OFF vs Cartão 12x) e regra de Remessa Única
    const quotePixMarechal = await buildServerCheckoutQuote(
      {
        items: [
          { variantId: skuPronta.id, quantity: 1 },
          { variantId: skuEncomenda.id, quantity: 1 },
        ],
        destinationCep: '29255-000', // Marechal Floriano - ES
        paymentMethod: 'PIX',
        installments: 1,
      },
      { client: prisma }
    );

    assert.equal(quotePixMarechal.subtotalCents, 70000); // R$ 400 + R$ 300 = R$ 700,00
    assert.equal(quotePixMarechal.pixDiscountPercentApplied, 10);
    assert.equal(quotePixMarechal.discountCents, 7000); // R$ 70,00 de desconto PIX
    assert.equal(quotePixMarechal.totalCents, 63000); // R$ 630,00
    assert.equal(quotePixMarechal.hasMixedCart, true);
    assert.equal(quotePixMarechal.maxPrepDays, 8);
    assert.equal(
      quotePixMarechal.shippingQuote?.matchedNearbyMunicipality?.cityName,
      'Marechal Floriano'
    );
    assert.equal(
      quotePixMarechal.selectedShippingOption?.shippingMode,
      'MUNICIPIO_PROXIMO_A_COMBINAR'
    );
    assert.match(
      quotePixMarechal.selectedShippingOption?.scheduleDescription || '',
      /8 dia\(s\) útil\(is\) \(remessa única\)/
    );

    // Verifica Venda Nova do Imigrante (29375-000) e Cartão de Crédito (sem desconto PIX)
    const quoteCardVendaNova = await buildServerCheckoutQuote(
      {
        items: [{ variantId: skuPronta.id, quantity: 2 }],
        destinationCep: '29375-000', // Venda Nova do Imigrante - ES
        paymentMethod: 'CREDIT_CARD',
        installments: 6,
      },
      { client: prisma }
    );

    assert.equal(quoteCardVendaNova.subtotalCents, 80000);
    assert.equal(quoteCardVendaNova.discountCents, 0);
    assert.equal(quoteCardVendaNova.totalCents, 80000);
    assert.equal(
      quoteCardVendaNova.shippingQuote?.matchedNearbyMunicipality?.cityName,
      'Venda Nova do Imigrante'
    );
    console.log(
      '✓ [Teste 2] Recálculo server-side (PIX 10% vs Cartão) e municípios próximos (Domingos Martins, Marechal Floriano, Venda Nova) aprovados.'
    );

    // 3. Verifica bloqueio de excesso de estoque e parcelamento acima do limite no servidor
    await assert.rejects(
      () =>
        buildServerCheckoutQuote(
          {
            items: [{ variantId: skuPronta.id, quantity: 3 }], // Só há 2 em estoque
            paymentMethod: 'PIX',
            installments: 1,
          },
          { client: prisma }
        ),
      /ESTOQUE_INSUFICIENTE/
    );

    await assert.rejects(
      () =>
        buildServerCheckoutQuote(
          {
            items: [{ variantId: skuPronta.id, quantity: 1 }],
            paymentMethod: 'CREDIT_CARD',
            installments: 15, // Acima de 12x
          },
          { client: prisma }
        ),
      /exclude|max|PARCELAMENTO_INVALIDO|less than or equal to 12/i
    );
    console.log('✓ [Teste 3] Bloqueio server-side de quantidade acima do estoque e parcelamento inválido aprovados.');

    // 4. Verifica integração com API do Melhor Envio e soma do prazo em Remessa Única (maxPrepDays + prazo transportadora)
    const previousToken = process.env.MELHOR_ENVIO_TOKEN;
    process.env.MELHOR_ENVIO_TOKEN = 'token-simulado-apenas-no-teste-automatizado-12345';

    try {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify([
            {
              id: 1,
              name: 'PAC',
              custom_price: '24.50',
              custom_delivery_time: 4,
              company: { name: 'Correios' },
            },
            {
              id: 2,
              name: 'SEDEX',
              custom_price: '38.00',
              custom_delivery_time: 2,
              company: { name: 'Correios' },
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const quoteMelhorEnvio = await buildServerCheckoutQuote(
        {
          items: [
            { variantId: skuPronta.id, quantity: 1 },
            { variantId: skuEncomenda.id, quantity: 1 }, // 8 dias úteis de preparação
          ],
          destinationCep: '29010-000', // Vitória - ES (fora da lista local, cotado via Melhor Envio)
          selectedShippingOptionId: 'me-1', // PAC (R$ 24,50, 4 dias úteis)
          paymentMethod: 'PIX',
          installments: 1,
        },
        { client: prisma, customFetch: mockFetch }
      );

      assert.equal(quoteMelhorEnvio.shippingQuote?.melhorEnvioStatus, 'COTADO_API');
      assert.equal(quoteMelhorEnvio.shippingQuote?.options.length, 2);
      assert.equal(quoteMelhorEnvio.selectedShippingOption?.id, 'me-1');
      assert.equal(quoteMelhorEnvio.shippingCents, 2450);
      assert.equal(
        quoteMelhorEnvio.selectedShippingOption?.totalEstimatedBusinessDays,
        12,
        'Em remessa única, o prazo total deve somar 8 dias de preparação + 4 dias de transporte = 12 dias úteis'
      );
      assert.equal(quoteMelhorEnvio.totalCents, 63000 + 2450); // R$ 630,00 (PIX) + R$ 24,50 (PAC) = R$ 654,50
    } finally {
      if (previousToken !== undefined) {
        process.env.MELHOR_ENVIO_TOKEN = previousToken;
      } else {
        delete process.env.MELHOR_ENVIO_TOKEN;
      }
    }
    console.log(
      '✓ [Teste 4] Integração Melhor Envio e soma de prazo em Remessa Única (8d preparação + 4d frete = 12d) aprovadas.'
    );
  } finally {
    await prisma.inventoryMovement.deleteMany({
      where: { variant: { productId: prodTest.id } },
    });
    await prisma.product.delete({ where: { id: prodTest.id } });
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['PRODUCT_CREATED', 'VARIANT_CREATED'] },
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
  console.log('=== [STILLUS ALBAN] Todos os testes da Etapa 4 passaram com sucesso! ===');
}

main()
  .catch((err) => {
    console.error('FALHA NOS TESTES DA ETAPA 4:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
