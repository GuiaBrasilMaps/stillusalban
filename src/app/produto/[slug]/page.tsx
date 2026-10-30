import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import StoreHeader from '@/components/storefront/StoreHeader';
import ProductDetailClient from '@/components/storefront/ProductDetailClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;

  const [settings, categories, municipalities, product] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.nearbyMunicipality.findMany({
      where: { isActive: true, allowArrangedDelivery: true },
      orderBy: { cityName: 'asc' },
    }),
    prisma.product.findUnique({
      where: { slug },
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
    }),
  ]);

  if (!product || product.status !== 'ACTIVE') {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-[#F5F5F4]">
      <StoreHeader
        storeName={settings?.storeName ?? 'STILLUS ALBAN'}
        categories={categories}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        <ProductDetailClient
          product={product}
          pixDiscountPercent={settings?.pixDiscountPercent ?? 10}
          maxInstallments={settings?.maxInstallments ?? 12}
          originCep={settings?.originCep ?? '29260-000'}
          nearbyCities={municipalities.map((m) => m.cityName)}
        />
      </main>

      <footer className="border-t border-[#262626] bg-[#0A0A0A] py-6 text-center text-xs text-[#A8A29E]">
        STILLUS ALBAN • Domingos Martins e Região, ES • PIX ({settings?.pixDiscountPercent ?? 10}% OFF) e Cartão em até {settings?.maxInstallments ?? 12}x
      </footer>
    </div>
  );
}
