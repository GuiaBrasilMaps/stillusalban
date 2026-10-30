import React from 'react';
import { prisma } from '@/lib/prisma';
import StoreHeader from '@/components/storefront/StoreHeader';
import CheckoutClient from '@/components/storefront/CheckoutClient';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const [settings, categories, municipalities] = await Promise.all([
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    }),
    prisma.nearbyMunicipality.findMany({
      where: { isActive: true, allowArrangedDelivery: true },
      orderBy: { cityName: 'asc' },
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-[#F5F5F4]">
      <StoreHeader
        storeName={settings?.storeName ?? 'STILLUS ALBAN'}
        categories={categories}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="border-b border-[#262626] pb-4">
          <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
            Finalização do Pedido
          </span>
          <h1 className="text-2xl sm:text-3xl font-serif text-[#D4AF37] font-semibold mt-1">
            Sacola, Frete e Condições de Pagamento
          </h1>
        </div>

        <CheckoutClient
          initialPixDiscountPercent={settings?.pixDiscountPercent ?? 10}
          initialMaxInstallments={settings?.maxInstallments ?? 12}
          originCep={settings?.originCep ?? '29260-000'}
          nearbyCities={municipalities.map((m) => m.cityName)}
        />
      </main>

      <footer className="border-t border-[#262626] bg-[#0A0A0A] py-6 text-center text-xs text-[#A8A29E]">
        STILLUS ALBAN • Domingos Martins e Região, ES
      </footer>
    </div>
  );
}
