import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { runSeed } from '../prisma/seed';
import {
  hashPassword,
  verifyPassword,
  signAdminSession,
  verifyAdminSession,
  assertAuthorizedRole,
} from '../src/lib/auth';
import { recordAuditLog } from '../src/lib/audit';
import { getIntegrationDiagnostics } from '../src/lib/integrations-status';

const prisma = new PrismaClient();

async function main() {
  console.log('=== [STILLUS ALBAN] Iniciando Testes Automatizados da Etapa 1 ===');

  // 1. Executa e valida o seed com parâmetros confirmados
  const seedResult = await runSeed(prisma);
  assert.equal(seedResult.storeSettings.originCep, '29260-000', 'CEP de origem deve ser 29260-000');
  assert.equal(seedResult.storeSettings.pixDiscountPercent, 10, 'Desconto PIX inicial deve ser 10%');
  assert.equal(seedResult.storeSettings.maxInstallments, 12, 'Parcelamento máximo deve ser 12x');
  assert.equal(seedResult.storeSettings.stockReservationMinutes, 30, 'Reserva deve ser 30 minutos');
  console.log('✓ [Teste 1] StoreSettings validado (CEP 29260-000, PIX 10%, 12x, reserva 30 min).');

  // 2. Verifica que o seed só cria usuário quando ADMIN_BOOTSTRAP_EMAIL está definido no .env
  assert.equal(
    seedResult.adminCreated,
    Boolean(process.env.ADMIN_BOOTSTRAP_EMAIL),
    'Seed deve respeitar estritamente a presença de ADMIN_BOOTSTRAP_EMAIL no ambiente.'
  );
  console.log('✓ [Teste 2] Ausência de senhas padrão hardcoded no seed confirmada.');

  // 3. Verifica lista inicial e editabilidade dos municípios próximos
  const municipalities = await prisma.nearbyMunicipality.findMany({
    orderBy: { cityName: 'asc' },
  });
  const cityNames = municipalities.map((m) => m.cityName);
  assert.ok(cityNames.includes('Domingos Martins'), 'Domingos Martins deve estar cadastrado');
  assert.ok(cityNames.includes('Marechal Floriano'), 'Marechal Floriano deve estar cadastrado');
  assert.ok(cityNames.includes('Venda Nova do Imigrante'), 'Venda Nova do Imigrante deve estar cadastrado');

  // Testa edição da lista de municípios próximos
  const marechal = municipalities.find((m) => m.cityName === 'Marechal Floriano')!;
  const updatedMun = await prisma.nearbyMunicipality.update({
    where: { id: marechal.id },
    data: { deliveryNotes: 'Entrega a combinar em Marechal Floriano ( Centro e Araguaia ).' },
  });
  assert.match(updatedMun.deliveryNotes, /Araguaia/);
  // Restaura valor original
  await prisma.nearbyMunicipality.update({
    where: { id: marechal.id },
    data: { deliveryNotes: marechal.deliveryNotes },
  });
  console.log('✓ [Teste 3] Lista de municípios próximos confirmada e editável no banco.');

  // 4. Testa constraint de unicidade de variação (Cor + Modelo + Tamanho) e limpeza
  const bolsasCategory = await prisma.category.findUniqueOrThrow({ where: { slug: 'bolsas' } });
  const tempProduct = await prisma.product.create({
    data: {
      categoryId: bolsasCategory.id,
      name: 'PRODUTO_TESTE_INTEGRIDADE_SCHEMA',
      slug: `teste-schema-${Date.now()}`,
      shortDescription: 'Registro temporário para teste de constraint relacional',
      basePriceCents: 25000,
      weightKg: 0.7,
      heightCm: 20,
      widthCm: 28,
      lengthCm: 35,
    },
  });

  await prisma.productVariant.create({
    data: {
      productId: tempProduct.id,
      skuCode: `SKU-TEST-1-${Date.now()}`,
      colorName: 'Preto',
      modelName: 'Couro',
      sizeLabel: 'Único',
      supplyMode: 'IN_STOCK',
      stockOnHand: 3,
    },
  });

  let duplicateBlocked = false;
  try {
    await prisma.productVariant.create({
      data: {
        productId: tempProduct.id,
        skuCode: `SKU-TEST-2-${Date.now()}`,
        colorName: 'Preto',
        modelName: 'Couro',
        sizeLabel: 'Único', // Mesma combinação Produto + Cor + Modelo + Tamanho
        supplyMode: 'IN_STOCK',
        stockOnHand: 1,
      },
    });
  } catch {
    duplicateBlocked = true;
  } finally {
    await prisma.product.delete({ where: { id: tempProduct.id } });
  }
  assert.equal(duplicateBlocked, true, 'Banco deve bloquear variação duplicada (Produto+Cor+Modelo+Tamanho)');
  console.log('✓ [Teste 4] Constraint UNIQUE(productId, colorName, modelName, sizeLabel) validada e limpa.');

  // 5. Testa autenticação, bloqueio sem segredo e autorização RBAC server-side
  const previousSecret = process.env.AUTH_JWT_SECRET;
  delete process.env.AUTH_JWT_SECRET;
  assert.throws(
    () =>
      signAdminSession({
        userId: 'u1',
        email: 'admin@stillus.local',
        role: 'ADMIN_OWNER',
      }),
    /AUTH_JWT_SECRET ausente/,
    'Deve recusar assinatura de token sem AUTH_JWT_SECRET configurado'
  );

  process.env.AUTH_JWT_SECRET = 'chave-exclusiva-de-teste-unitario-segura-2026';
  const hash = await hashPassword('SenhaForte#2026');
  assert.equal(await verifyPassword('SenhaForte#2026', hash), true);
  assert.equal(await verifyPassword('SenhaErrada', hash), false);

  const operatorToken = signAdminSession({
    userId: 'op-1',
    email: 'operador@stillus.local',
    role: 'OPERATOR',
  });
  const verifiedOperator = verifyAdminSession(operatorToken);
  assert.equal(verifiedOperator?.role, 'OPERATOR');

  assert.throws(
    () => assertAuthorizedRole(verifiedOperator, ['ADMIN_OWNER']),
    /ACESSO_NEGADO/,
    'Operador não pode executar ação exclusiva de ADMIN_OWNER'
  );
  if (previousSecret !== undefined) {
    process.env.AUTH_JWT_SECRET = previousSecret;
  } else {
    delete process.env.AUTH_JWT_SECRET;
  }
  console.log('✓ [Teste 5] Autenticação, hash bcrypt e RBAC server-side validados.');

  // 6. Testa serviço de Auditoria (AuditLog)
  const auditEntry = await recordAuditLog(
    {
      actorUserId: null,
      action: 'STAGE1_INTEGRITY_TEST',
      entityType: 'StoreSettings',
      entityId: 'default',
      before: { pixDiscountPercent: 5 },
      after: { pixDiscountPercent: 10 },
      ipAddress: '127.0.0.1',
    },
    prisma
  );
  assert.equal(auditEntry.action, 'STAGE1_INTEGRITY_TEST');
  await prisma.auditLog.delete({ where: { id: auditEntry.id } });
  console.log('✓ [Teste 6] Registro e persistência de AuditLog validados.');

  // 7. Testa transparência do diagnóstico de integrações externas
  const diag = getIntegrationDiagnostics(seedResult.storeSettings);
  assert.equal(diag.melhorEnvio.originCep, '29260-000');
  assert.equal(diag.melhorEnvio.status, 'PENDENTE_TOKEN');
  assert.equal(diag.infinitePay.status, 'PENDENTE_INFINITETAG');
  assert.equal(diag.whatsapp.status, 'PRONTO');
  assert.equal(seedResult.storeSettings.whatsappNumber, '5527996929005');
  console.log('✓ [Teste 7] Diagnóstico transparente de integrações externas e WhatsApp (5527996929005) validados.');

  console.log('=== [STILLUS ALBAN] Todos os 7 testes da Etapa 1 passaram com sucesso! ===');
}

main()
  .catch((err) => {
    console.error('FALHA NOS TESTES DA ETAPA 1:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
