import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getIntegrationDiagnostics } from '@/lib/integrations-status';

export async function GET() {
  const [settings, categoriesCount, municipalities, productsCount] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.category.count({ where: { isActive: true } }),
    prisma.nearbyMunicipality.findMany({
      where: { isActive: true },
      select: { cityName: true, stateUf: true, cepStart: true, cepEnd: true, allowArrangedDelivery: true },
      orderBy: { cityName: 'asc' },
    }),
    prisma.product.count(),
  ]);

  const integrations = getIntegrationDiagnostics(settings ?? undefined);

  return NextResponse.json({
    stage: 'ETAPA_1_FUNDACAO',
    storeSettings: settings,
    categoriesCount,
    municipalities,
    productsCount,
    integrations,
  });
}
