'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  calculatePixPriceCents,
  CartItemSnapshot,
  formatCurrencyBRL,
} from '@/lib/storefront';
import { CART_STORAGE_KEY } from './StoreHeader';

interface CartSummaryBarProps {
  pixDiscountPercent: number;
}

export default function CartSummaryBar({ pixDiscountPercent }: CartSummaryBarProps) {
  const [items, setItems] = useState<CartItemSnapshot[]>([]);

  useEffect(() => {
    function loadCart() {
      try {
        const raw = window.localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) {
          setItems([]);
          return;
        }
        setItems(JSON.parse(raw) as CartItemSnapshot[]);
      } catch {
        setItems([]);
      }
    }

    loadCart();
    window.addEventListener('stillus-cart-updated', loadCart);
    window.addEventListener('storage', loadCart);
    return () => {
      window.removeEventListener('stillus-cart-updated', loadCart);
      window.removeEventListener('storage', loadCart);
    };
  }, []);

  function updateQuantity(variantId: string, nextQty: number) {
    const next = items
      .map((item) => {
        if (item.variantId !== variantId) return item;
        const clamped = Math.min(Math.max(0, nextQty), item.maxPurchaseQuantity);
        return { ...item, quantity: clamped };
      })
      .filter((item) => item.quantity > 0);

    setItems(next);
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('stillus-cart-updated'));
  }

  function clearCart() {
    setItems([]);
    window.localStorage.removeItem(CART_STORAGE_KEY);
    window.dispatchEvent(new Event('stillus-cart-updated'));
  }

  if (items.length === 0) {
    return null;
  }

  const subtotalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );
  const pixTotalCents = calculatePixPriceCents(subtotalCents, pixDiscountPercent);

  const hasInStock = items.some((i) => i.supplyMode === 'IN_STOCK');
  const hasMadeToOrder = items.some(
    (i) =>
      i.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ||
      i.supplyMode === 'MADE_TO_ORDER_TBD_LEAD'
  );
  const maxPrepDays = items.reduce(
    (max, i) => Math.max(max, i.prepDays ?? 0),
    0
  );
  const hasTbdLeadTime = items.some((i) => i.supplyMode === 'MADE_TO_ORDER_TBD_LEAD');

  return (
    <section
      id="resumo-carrinho"
      aria-label="Sacola de compras e variações selecionadas"
      className="rounded-xl border border-[#D4AF37]/50 bg-[#141414] p-5 sm:p-6 space-y-4 shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262626] pb-3">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#C5A059] block">
            Minha Sacola
          </span>
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold">
            Itens Selecionados ({items.reduce((a, b) => a + b.quantity, 0)})
          </h2>
        </div>

        <button
          type="button"
          onClick={clearCart}
          className="min-h-[40px] px-3 py-1.5 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#EF4444] text-xs text-[#A8A29E] hover:text-[#EF4444] transition cursor-pointer"
        >
          Esvaziar Sacola
        </button>
      </div>

      {/* Aviso de Remessa Única em Carrinho Misto */}
      {hasInStock && hasMadeToOrder && (
        <div
          role="note"
          className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3.5 text-xs text-[#F5F5F4] space-y-1"
        >
          <strong className="text-[#D4AF37] block">
            Regra de Envio para Pedido Combinado (Estoque Próprio + Sob Encomenda):
          </strong>
          <p className="text-[#A8A29E]">
            Sua sacola combina produtos em estoque próprio e sob encomenda. O envio será realizado
            em <strong className="text-[#F5F5F4]">remessa única</strong> assim que o item sob
            encomenda estiver pronto
            {maxPrepDays > 0 ? ` (prazo de preparação: ${maxPrepDays} dia(s) útil(is))` : ''}.
          </p>
        </div>
      )}

      {hasTbdLeadTime && (
        <div
          role="note"
          className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3.5 text-xs text-[#F59E0B]"
        >
          Há item(ns) sob encomenda cujo prazo de preparação será confirmado pela equipe após o
          pedido.
        </div>
      )}

      {/* Lista de Itens com Variação Preservada */}
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.variantId}
            className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              {item.specificImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.specificImageUrl}
                  alt={`${item.productName} - Cor ${item.colorName}`}
                  className="w-16 h-16 rounded object-cover border border-[#262626] shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded border border-[#262626] bg-[#141414] flex items-center justify-center text-[10px] text-center text-[#A8A29E] p-1 shrink-0">
                  Sem foto ({item.colorName})
                </div>
              )}

              <div className="space-y-1 text-xs">
                <Link
                  href={`/produto/${item.productSlug}`}
                  className="text-sm font-semibold text-[#F5F5F4] hover:text-[#D4AF37]"
                >
                  {item.productName}
                </Link>
                <div className="text-[#A8A29E]">
                  SKU: <strong className="text-[#D4AF37]">{item.skuCode}</strong> • Cor:{' '}
                  <strong className="text-[#F5F5F4]">{item.colorName}</strong> • Modelo:{' '}
                  <strong className="text-[#F5F5F4]">{item.modelName}</strong> • Tamanho:{' '}
                  <strong className="text-[#F5F5F4]">{item.sizeLabel}</strong>
                </div>
                <div>
                  {item.supplyMode === 'IN_STOCK' && (
                    <span className="text-[#10B981]">
                      Modalidade: Em estoque próprio (máx. {item.maxPurchaseQuantity} un.)
                    </span>
                  )}
                  {item.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' && (
                    <span className="text-[#D4AF37]">
                      Modalidade: Sob encomenda • Preparação: {item.prepDays} dia(s) útil(is)
                    </span>
                  )}
                  {item.supplyMode === 'MADE_TO_ORDER_TBD_LEAD' && (
                    <span className="text-[#F59E0B]">
                      Modalidade: Sob encomenda • Prazo a confirmar
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-4">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Diminuir quantidade de ${item.productName}`}
                  onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                  className="min-w-[40px] min-h-[40px] rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] text-sm font-bold cursor-pointer"
                >
                  -
                </button>
                <span className="px-3 text-sm font-semibold">{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Aumentar quantidade de ${item.productName}`}
                  disabled={item.quantity >= item.maxPurchaseQuantity}
                  onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                  className="min-w-[40px] min-h-[40px] rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] disabled:opacity-40 text-sm font-bold cursor-pointer"
                >
                  +
                </button>
              </div>

              <div className="text-right min-w-[100px]">
                <strong className="text-sm text-[#D4AF37] block">
                  {formatCurrencyBRL(item.unitPriceCents * item.quantity)}
                </strong>
                <span className="text-[11px] text-[#A8A29E]">
                  {formatCurrencyBRL(item.unitPriceCents)} / un.
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Subtotal da Sacola e Avanço para Checkout */}
      <div className="border-t border-[#262626] pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs text-[#A8A29E] block">
            Subtotal: {formatCurrencyBRL(subtotalCents)}
          </span>
          <strong className="text-base sm:text-lg text-[#D4AF37]">
            No PIX ({pixDiscountPercent}% OFF): {formatCurrencyBRL(pixTotalCents)}
          </strong>
        </div>

        <Link
          href="/checkout"
          className="min-h-[48px] inline-flex items-center justify-center px-6 py-3 rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-semibold text-sm sm:text-base transition shadow-lg"
        >
          Simular Frete e Ir para o Checkout
        </Link>
      </div>
    </section>
  );
}
