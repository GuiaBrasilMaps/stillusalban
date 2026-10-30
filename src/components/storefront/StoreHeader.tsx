'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export const CART_STORAGE_KEY = 'stillus_alban_cart_v1';

interface StoreHeaderProps {
  storeName?: string;
  categories?: Array<{ id: string; name: string; slug: string }>;
  initialQuery?: string;
  whatsappNumber?: string;
}

export default function StoreHeader({
  storeName = 'STILLUS ALBAN',
  whatsappNumber = '5527996929005',
}: StoreHeaderProps) {
  const [interestCount, setInterestCount] = useState(0);

  useEffect(() => {
    function syncInterestList() {
      try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) {
          setInterestCount(0);
          return;
        }
        const items = JSON.parse(raw);
        if (Array.isArray(items)) {
          setInterestCount(items.length);
        } else {
          setInterestCount(0);
        }
      } catch {
        setInterestCount(0);
      }
    }

    syncInterestList();
    window.addEventListener('stillus-cart-updated', syncInterestList);
    window.addEventListener('storage', syncInterestList);
    return () => {
      window.removeEventListener('stillus-cart-updated', syncInterestList);
      window.removeEventListener('storage', syncInterestList);
    };
  }, []);

  const cleanWa = (whatsappNumber || '5527996929005').replace(/\D/g, '') || '5527996929005';
  const directWaUrl = `https://wa.me/${cleanWa}?text=${encodeURIComponent(
    'Olá, STILLUS ALBAN! Estou na loja online e gostaria de tirar uma dúvida.'
  )}`;

  return (
    <header className="border-b border-[#D4AF37]/20 bg-[#0A0A0A]/90 sticky top-0 z-40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.65)]">
      {/* Faixa de Assinatura Superior Dourada */}
      <div className="bg-gradient-to-r from-[#1A150B] via-[#261E0D] to-[#1A150B] border-b border-[#D4AF37]/25 px-4 py-1.5 text-center">
        <p className="text-[11px] tracking-[0.14em] uppercase text-[#E5C453] font-medium">
          ✦ <strong className="font-bold">10% OFF no PIX</strong> • Até 12x no Cartão • Entrega a
          Combinar em <strong className="font-bold">Domingos Martins e Região</strong> ✦
        </p>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="group flex items-center gap-3.5">
          {/* Monograma Brasão SA */}
          <span className="w-10 h-10 rounded-full border border-[#D4AF37]/60 bg-gradient-to-br from-[#231D11] to-[#0A0A0A] flex items-center justify-center font-serif text-sm font-bold text-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.2)] group-hover:border-[#E5C453] transition">
            SA
          </span>
          <div>
            <span className="text-[10px] uppercase tracking-[0.28em] text-[#C5A059] block">
              Bolsas, Calçados &amp; Acessórios
            </span>
            <span className="text-xl sm:text-2xl font-serif tracking-[0.2em] text-[#D4AF37] group-hover:text-[#E5C453] font-semibold block transition">
              {storeName}
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          {interestCount > 0 && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('stillus-open-interest-drawer'))}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-[#D4AF37]/50 bg-[#141414] hover:border-[#D4AF37] text-xs text-[#F5F5F4] font-medium transition cursor-pointer shadow"
            >
              <span className="hidden sm:inline">Minha Sacola:</span>
              <strong className="px-2 py-0.5 rounded-full bg-[#D4AF37] text-[#0A0A0A] text-[11px] font-bold tabular-nums">
                {interestCount}
              </strong>
            </button>
          )}

          <a
            href={directWaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#D4AF37] bg-[#D4AF37] hover:bg-[#E5C453] text-xs font-bold text-[#0A0A0A] transition shadow-[0_4px_14px_rgba(212,175,55,0.25)]"
          >
            <span>Atendimento pelo WhatsApp</span>
          </a>
        </div>
      </div>
    </header>
  );
}
