import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function runSeed(client: PrismaClient = prisma) {
  // 1. Configurações confirmadas da loja STILLUS ALBAN
  const storeSettings = await client.storeSettings.upsert({
    where: { id: 'default' },
    update: {
      storeName: 'STILLUS ALBAN',
      originCep: process.env.STORE_ORIGIN_CEP || '29260-000',
      pixDiscountPercent: Number(process.env.STORE_PIX_DISCOUNT_PERCENT || 10),
      defaultMarkupPercent: Number(process.env.STORE_DEFAULT_MARKUP_PERCENT || 120),
      maxInstallments: Number(process.env.STORE_MAX_INSTALLMENTS || 12),
      stockReservationMinutes: Number(process.env.STORE_STOCK_RESERVATION_MINUTES || 30),
      whatsappNumber: process.env.STORE_WHATSAPP_NUMBER || '5527996929005',
    },
    create: {
      id: 'default',
      storeName: 'STILLUS ALBAN',
      originCep: process.env.STORE_ORIGIN_CEP || '29260-000',
      pixDiscountPercent: Number(process.env.STORE_PIX_DISCOUNT_PERCENT || 10),
      defaultMarkupPercent: Number(process.env.STORE_DEFAULT_MARKUP_PERCENT || 120),
      maxInstallments: Number(process.env.STORE_MAX_INSTALLMENTS || 12),
      stockReservationMinutes: Number(process.env.STORE_STOCK_RESERVATION_MINUTES || 30),
      whatsappNumber: process.env.STORE_WHATSAPP_NUMBER || '5527996929005',
    },
  });

  // 2. Categorias confirmadas do segmento (sem produtos ou preços fictícios)
  const confirmedCategories = [
    {
      name: 'Bolsas',
      slug: 'bolsas',
      description: 'Bolsas em estoque próprio e sob encomenda.',
      displayOrder: 1,
      defaultWeightKg: 0.7,
      defaultHeightCm: 20,
      defaultWidthCm: 28,
      defaultLengthCm: 35,
    },
    {
      name: 'Calçados',
      slug: 'calcados',
      description: 'Calçados disponíveis em estoque próprio e sob encomenda.',
      displayOrder: 2,
      defaultWeightKg: 0.8,
      defaultHeightCm: 14,
      defaultWidthCm: 22,
      defaultLengthCm: 32,
    },
    {
      name: 'Acessórios',
      slug: 'acessorios',
      description: 'Carteiras, cintos e produtos relacionados.',
      displayOrder: 3,
      defaultWeightKg: 0.3,
      defaultHeightCm: 10,
      defaultWidthCm: 16,
      defaultLengthCm: 22,
    },
  ];

  for (const cat of confirmedCategories) {
    await client.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
  }

  // 3. Municípios próximos confirmados para a regra de "Entrega a combinar" (editáveis no painel)
  const confirmedMunicipalities = [
    {
      cityName: 'Domingos Martins',
      stateUf: 'ES',
      cepStart: '29260000',
      cepEnd: '29279999',
      allowArrangedDelivery: true,
      fixedFeeCents: null,
      deliveryNotes: 'Entrega a combinar em Domingos Martins (Sede e distritos).',
      isActive: true,
    },
    {
      cityName: 'Marechal Floriano',
      stateUf: 'ES',
      cepStart: '29255000',
      cepEnd: '29259999',
      allowArrangedDelivery: true,
      fixedFeeCents: null,
      deliveryNotes: 'Entrega a combinar para Marechal Floriano.',
      isActive: true,
    },
    {
      cityName: 'Venda Nova do Imigrante',
      stateUf: 'ES',
      cepStart: '29375000',
      cepEnd: '29379999',
      allowArrangedDelivery: true,
      fixedFeeCents: null,
      deliveryNotes: 'Entrega a combinar para Venda Nova do Imigrante.',
      isActive: true,
    },
  ];

  for (const mun of confirmedMunicipalities) {
    const existing = await client.nearbyMunicipality.findFirst({
      where: { cityName: mun.cityName, stateUf: mun.stateUf },
    });
    if (existing) {
      await client.nearbyMunicipality.update({
        where: { id: existing.id },
        data: mun,
      });
    } else {
      await client.nearbyMunicipality.create({ data: mun });
    }
  }

  // 4. Bootstrap opcional e seguro de administrador (NUNCA cria senha padrão hardcoded)
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  let adminCreated = false;
  if (bootstrapEmail && bootstrapPassword && bootstrapPassword.length >= 8) {
    const passwordHash = await bcrypt.hash(bootstrapPassword, 12);
    const admin = await client.user.upsert({
      where: { email: bootstrapEmail.toLowerCase() },
      update: {
        passwordHash,
        role: 'ADMIN_OWNER',
        isActive: true,
      },
      create: {
        name: 'Administrador STILLUS ALBAN',
        email: bootstrapEmail.toLowerCase(),
        passwordHash,
        role: 'ADMIN_OWNER',
        isActive: true,
      },
    });

    await client.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: 'ADMIN_BOOTSTRAP_UPSERT',
        entityType: 'User',
        entityId: admin.id,
        afterJson: JSON.stringify({ email: admin.email, role: admin.role }),
      },
    });
    adminCreated = true;
  }

  return {
    storeSettings,
    categoriesCount: confirmedCategories.length,
    municipalitiesCount: confirmedMunicipalities.length,
    adminCreated,
  };
}

if (require.main === module) {
  runSeed()
    .then((res) => {
      console.log('[STILLUS ALBAN Seed] Concluído com sucesso:', {
        originCep: res.storeSettings.originCep,
        pixDiscountPercent: res.storeSettings.pixDiscountPercent,
        maxInstallments: res.storeSettings.maxInstallments,
        categoriesCount: res.categoriesCount,
        municipalitiesCount: res.municipalitiesCount,
        adminBootstrapConfigured: res.adminCreated,
      });
    })
    .catch((err) => {
      console.error('[STILLUS ALBAN Seed] Erro:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
