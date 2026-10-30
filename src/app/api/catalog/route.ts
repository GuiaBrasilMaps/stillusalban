import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { filterAndSortCatalogProducts } from '@/lib/storefront';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const categorySlug = searchParams.get('categoria') || undefined;
  const availabilityParam = searchParams.get('disponibilidade') || 'ALL';
  const color = searchParams.get('cor') || undefined;
  const size = searchParams.get('tamanho') || undefined;
  const searchQuery = searchParams.get('q') || undefined;
  const sortByParam = searchParams.get('ordenar') || 'recentes';

  const availability =
    availabilityParam === 'IN_STOCK' || availabilityParam === 'MADE_TO_ORDER'
      ? availabilityParam
      : 'ALL';

  const sortBy =
    sortByParam === 'menor_preco' || sortByParam === 'maior_preco'
      ? sortByParam
      : 'recentes';

  const [settings, categories, rawProducts] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.product.findMany({
      where: { status: 'ACTIVE' },
      include: {
        category: true,
        variants: {
          where: { isActive: true },
          orderBy: [{ colorName: 'asc' }, { sizeLabel: 'asc' }],
        },
        images: {
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const products = filterAndSortCatalogProducts(rawProducts, {
    categorySlug,
    availability,
    color,
    size,
    searchQuery,
    sortBy,
  });

  return NextResponse.json({
    storeSettings: settings,
    categories,
    totalFound: products.length,
    products,
  });
}
