import React from 'react';
import { prisma } from '@/lib/prisma';
import StoreHeader from '@/components/storefront/StoreHeader';
import ShowroomBoutiqueCatalog from '@/components/storefront/ShowroomBoutiqueCatalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
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
        />
      </main>

      <footer className="border-t border-[#D4AF37]/20 bg-[#0A0A0A] py-12 px-4 text-xs text-[#A8A29E]">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          <div className="space-y-2">
            <p className="font-serif tracking-[0.22em] text-[#D4AF37] text-base font-semibold">
              STILLUS ALBAN
            </p>
            <p className="leading-relaxed">
              Curadoria exclusiva de bolsas estruturadas, calçados sofisticados e acessórios em
              estoque próprio e sob encomenda.
            </p>
          </div>

          <div className="space-y-2">
            <strong className="uppercase tracking-widest text-[#F5F5F4] block">
              Logística &amp; Entrega Regional
            </strong>
            <p className="leading-relaxed">
              Atendimento e entrega a combinar em <strong className="text-[#D4AF37]">Domingos Martins</strong>,{' '}
              <strong className="text-[#D4AF37]">Marechal Floriano</strong> e{' '}
              <strong className="text-[#D4AF37]">Venda Nova do Imigrante (ES)</strong>, além de
              envio para todo o Brasil.
            </p>
          </div>

          <div className="space-y-2 md:text-right">
            <strong className="uppercase tracking-widest text-[#F5F5F4] block">
              Condições &amp; Atendimento VIP
            </strong>
            <p className="text-[#10B981] font-semibold">
              ✦ {pixDiscountPercent}% de desconto imediato no PIX
            </p>
            <p>Parcelamento em até {maxInstallments}x no cartão de crédito</p>
            <p className="text-[#C5A059]">WhatsApp Oficial: (27) 99692-9005</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
