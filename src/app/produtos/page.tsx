import React from 'react';
import { prisma } from '@/lib/prisma';
import StoreHeader from '@/components/storefront/StoreHeader';
import ShowroomBoutiqueCatalog from '@/components/storefront/ShowroomBoutiqueCatalog';

export const dynamic = 'force-dynamic';

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{
    categoria?: string;
    disponibilidade?: string;
    q?: string;
  }>;
}) {
  const params = await searchParams;

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

  const pixDiscountPercent = settings?.pixDiscountPercent ?? 10;
  const maxInstallments = settings?.maxInstallments ?? 12;
  const whatsappNumber =
    settings?.whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '5527996929005';

  const initialAvailability =
    params.disponibilidade === 'IN_STOCK'
      ? 'IN_STOCK'
      : params.disponibilidade === 'MADE_TO_ORDER'
      ? 'MADE_TO_ORDER'
      : 'ALL';

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-[#F5F5F4]">
      <StoreHeader
        storeName={settings?.storeName ?? 'STILLUS ALBAN'}
        categories={categories}
        whatsappNumber={whatsappNumber}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <ShowroomBoutiqueCatalog
          products={rawProducts}
          categories={categories}
          pixDiscountPercent={pixDiscountPercent}
          maxInstallments={maxInstallments}
          whatsappNumber={whatsappNumber}
          initialCategorySlug={params.categoria || ''}
          initialAvailability={initialAvailability}
          initialSearchQuery={params.q || ''}
        />
      </main>
    </div>
  );
}
