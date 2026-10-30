'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CartItemSnapshot,
  formatCurrencyBRL,
} from '@/lib/storefront';
import { isValidBrazilianCpf, ServerCheckoutQuote } from '@/lib/checkout-quote';
import { CART_STORAGE_KEY } from './StoreHeader';

interface CheckoutClientProps {
  initialPixDiscountPercent: number;
  initialMaxInstallments: number;
  originCep: string;
  nearbyCities: string[];
}

export default function CheckoutClient({
  initialPixDiscountPercent,
  initialMaxInstallments,
  originCep,
  nearbyCities,
}: CheckoutClientProps) {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<CartItemSnapshot[]>([]);
  const [loadedLocal, setLoadedLocal] = useState(false);

  // Dados da Cliente e Endereço (editáveis antes de concluir)
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phoneWhatsapp, setPhoneWhatsapp] = useState('');
  const [cep, setCep] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('ES');
  const [customerNotes, setCustomerNotes] = useState('');

  // Pagamento e Frete
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [installments, setInstallments] = useState(1);
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState<string>('');
  const [agreedToMadeToOrderTerms, setAgreedToMadeToOrderTerms] = useState(false);

  // Cotação Validada no Servidor e Submissão Idempotente
  const [serverQuote, setServerQuote] = useState<ServerCheckoutQuote | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submittingChannel, setSubmittingChannel] = useState<
    'SITE_CHECKOUT' | 'WHATSAPP_ASSISTED' | null
  >(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencySeed] = useState(() => `sa-chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        setCartItems(JSON.parse(raw) as CartItemSnapshot[]);
      }
    } catch {
      setCartItems([]);
    } finally {
      setLoadedLocal(true);
    }
  }, []);

  const fetchServerQuote = useCallback(
    async (
      itemsToQuote: CartItemSnapshot[],
      destCep: string,
      shipOptId: string,
      payMethod: 'PIX' | 'CREDIT_CARD',
      inst: number
    ) => {
      if (itemsToQuote.length === 0) {
        setServerQuote(null);
        return;
      }

      setCalculating(true);
      setQuoteError(null);

      try {
        const res = await fetch('/api/shipping/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: itemsToQuote.map((i) => ({
              variantId: i.variantId,
              quantity: i.quantity,
            })),
            destinationCep: destCep.replace(/\D/g, '').length === 8 ? destCep : undefined,
            selectedShippingOptionId: shipOptId || undefined,
            paymentMethod: payMethod,
            installments: inst,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setQuoteError(data.error || 'Erro ao validar itens e frete no servidor.');
          return;
        }

        const q = data.quote as ServerCheckoutQuote;
        setServerQuote(q);
        if (q.selectedShippingOption) {
          setSelectedShippingOptionId(q.selectedShippingOption.id);
        }
        if (q.shippingQuote?.matchedNearbyMunicipality && !city) {
          setCity(q.shippingQuote.matchedNearbyMunicipality.cityName);
          setStateUf(q.shippingQuote.matchedNearbyMunicipality.stateUf);
        }
      } catch {
        setQuoteError('Falha de comunicação ao recalcular totais no servidor.');
      } finally {
        setCalculating(false);
      }
    },
    [city]
  );

  useEffect(() => {
    if (!loadedLocal) return;
    fetchServerQuote(cartItems, cep, selectedShippingOptionId, paymentMethod, installments);
  }, [
    loadedLocal,
    cartItems,
    cep,
    selectedShippingOptionId,
    paymentMethod,
    installments,
    fetchServerQuote,
  ]);

  function handleUpdateQuantity(variantId: string, nextQty: number) {
    const updated = cartItems
      .map((item) => {
        if (item.variantId !== variantId) return item;
        const clamped = Math.min(Math.max(0, nextQty), item.maxPurchaseQuantity);
        return { ...item, quantity: clamped };
      })
      .filter((item) => item.quantity > 0);

    setCartItems(updated);
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('stillus-cart-updated'));
  }

  async function handleCreateOrder(channel: 'SITE_CHECKOUT' | 'WHATSAPP_ASSISTED') {
    setSubmitError(null);
    setSubmittingChannel(channel);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          idempotencyKey: `${idempotencySeed}-${channel}`,
          agreedToMadeToOrderTerms,
          items: cartItems.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
          })),
          destinationCep: cep.replace(/\D/g, ''),
          selectedShippingOptionId: selectedShippingOptionId || undefined,
          paymentMethod,
          installments,
          customer: {
            fullName,
            cpf,
            email,
            phoneWhatsapp,
          },
          address: {
            cep,
            street,
            number,
            complement: complement || null,
            neighborhood,
            city,
            state: stateUf,
          },
          customerNotes: customerNotes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || 'Não foi possível registrar o pedido.');
        setSubmittingChannel(null);
        return;
      }

      // Limpa a sacola local após criação confirmada do protocolo
      window.localStorage.removeItem(CART_STORAGE_KEY);
      window.dispatchEvent(new Event('stillus-cart-updated'));

      router.push(`/pedido/${data.order.orderNumber}`);
    } catch {
      setSubmitError('Falha de conexão ao criar o pedido. Tente novamente.');
      setSubmittingChannel(null);
    }
  }

  const cpfDigits = cpf.replace(/\D/g, '');
  const cpfInvalid = cpfDigits.length > 0 && !isValidBrazilianCpf(cpfDigits);

  if (loadedLocal && cartItems.length === 0) {
    return (
      <section className="rounded-xl border border-[#262626] bg-[#141414] p-8 text-center space-y-4">
        <h1 className="text-2xl font-serif text-[#D4AF37]">Sua sacola está vazia</h1>
        <p className="text-sm text-[#A8A29E] max-w-md mx-auto">
          Selecione bolsas, calçados ou acessórios no catálogo para revisar quantidades, simular
          frete e escolher a forma de pagamento.
        </p>
        <Link
          href="/produtos"
          className="min-h-[44px] inline-flex items-center px-6 py-2.5 rounded-lg bg-[#D4AF37] text-[#0A0A0A] text-sm font-semibold"
        >
          Ir para o Catálogo
        </Link>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Coluna Esquerda (7 cols): Itens, Endereço/Frete e Dados da Cliente */}
      <div className="lg:col-span-7 space-y-6">
        {/* 1. Revisão e Correção de Produtos e Quantidades */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#262626] pb-3">
            <h2 className="text-lg font-serif text-[#D4AF37] font-semibold">
              1. Produtos e Variações Selecionadas
            </h2>
            <Link href="/produtos" className="text-xs text-[#C5A059] hover:text-[#D4AF37] underline">
              Adicionar mais itens
            </Link>
          </div>

          {serverQuote?.hasMixedCart && (
            <div
              role="note"
              className="rounded-lg border border-[#D4AF37]/50 bg-[#D4AF37]/10 p-3.5 text-xs text-[#F5F5F4] space-y-1"
            >
              <strong className="text-[#D4AF37] block">
                Pedido Combinado • Envio em Remessa Única:
              </strong>
              <p className="text-[#A8A29E]">
                Este pedido combina itens em <strong className="text-[#F5F5F4]">estoque próprio</strong> e
                itens <strong className="text-[#F5F5F4]">sob encomenda</strong>. Conforme a regra da
                loja, todos os itens serão enviados juntos em{' '}
                <strong className="text-[#D4AF37]">remessa única</strong> assim que o item
                encomendado estiver pronto
                {serverQuote.maxPrepDays > 0
                  ? ` (preparação: ${serverQuote.maxPrepDays} dia(s) útil(is))`
                  : ''}
                .
              </p>
            </div>
          )}

          <div className="space-y-3">
            {(serverQuote?.items || []).map((item) => (
              <div
                key={item.variantId}
                className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 text-xs">
                  <Link
                    href={`/produto/${item.productSlug}`}
                    className="text-sm font-semibold text-[#F5F5F4] hover:text-[#D4AF37]"
                  >
                    {item.snapshotProductName}
                  </Link>
                  <div className="text-[#A8A29E]">
                    SKU: <strong className="text-[#D4AF37]">{item.snapshotSkuCode}</strong> • Cor:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotColorName}</strong> • Modelo:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotModelName}</strong> • Tam:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotSizeLabel}</strong>
                  </div>
                  <span className="inline-block text-[11px] text-[#C5A059]">
                    {item.badgeLabel}
                  </span>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Diminuir quantidade de ${item.snapshotProductName}`}
                      onClick={() => handleUpdateQuantity(item.variantId, item.quantity - 1)}
                      className="min-w-[40px] min-h-[40px] rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] font-bold cursor-pointer"
                    >
                      -
                    </button>
                    <span className="px-3 text-sm font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Aumentar quantidade de ${item.snapshotProductName}`}
                      onClick={() => handleUpdateQuantity(item.variantId, item.quantity + 1)}
                      className="min-w-[40px] min-h-[40px] rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] font-bold cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-right min-w-[100px]">
                    <strong className="text-sm text-[#D4AF37] block">
                      {formatCurrencyBRL(item.lineTotalCents)}
                    </strong>
                    <span className="text-[11px] text-[#A8A29E]">
                      {formatCurrencyBRL(item.unitPriceCents)} / un.
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Cálculo de Entrega (Melhor Envio + Entrega a Combinar Regional) */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            2. Simulação de Entrega e Endereço
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="checkout-cep" className="block text-xs text-[#F5F5F4] mb-1">
                CEP de Entrega (8 dígitos) *
              </label>
              <input
                id="checkout-cep"
                type="text"
                inputMode="numeric"
                maxLength={9}
                value={cep}
                onChange={(e) => setCep(e.target.value)}
                placeholder="Ex.: 29260-000"
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3.5 text-sm text-[#F5F5F4]"
              />
              <span className="text-[11px] text-[#A8A29E] mt-1 block">
                Origem: Domingos Martins/ES ({originCep}). Entrega a combinar ativa para:{' '}
                {nearbyCities.join(', ')}.
              </span>
            </div>
          </div>

          {serverQuote?.shippingQuote && (
            <div className="space-y-3 pt-2">
              <span className="block text-xs uppercase tracking-wider text-[#C5A059]">
                Modalidades de Entrega Disponíveis para o CEP {serverQuote.shippingQuote.destinationCep}:
              </span>

              {serverQuote.shippingQuote.melhorEnvioMessage && (
                <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3 text-xs text-[#A8A29E]">
                  {serverQuote.shippingQuote.melhorEnvioMessage}
                </div>
              )}

              {serverQuote.shippingQuote.options.length === 0 ? (
                <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3.5 text-xs text-[#F59E0B]">
                  Este CEP está fora dos municípios de Entrega a Combinar ({nearbyCities.join(', ')})
                  e a cotação automática de transportadoras aguarda a ativação do token do Melhor
                  Envio. Você poderá encaminhar seu pedido para cotação via WhatsApp na próxima
                  etapa.
                </div>
              ) : (
                <div
                  role="radiogroup"
                  aria-label="Selecionar modalidade de entrega"
                  className="space-y-2"
                >
                  {serverQuote.shippingQuote.options.map((opt) => {
                    const isSelected = selectedShippingOptionId === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`flex items-start justify-between gap-4 rounded-lg border p-4 cursor-pointer transition ${
                          isSelected
                            ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                            : 'border-[#262626] bg-[#0A0A0A] hover:border-[#C5A059]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="shippingOption"
                            checked={isSelected}
                            onChange={() => setSelectedShippingOptionId(opt.id)}
                            className="mt-1 accent-[#D4AF37]"
                          />
                          <div className="text-xs space-y-1">
                            <strong className="text-sm text-[#F5F5F4] block">
                              {opt.serviceName} ({opt.carrierName})
                            </strong>
                            <p className="text-[#A8A29E]">{opt.scheduleDescription}</p>
                          </div>
                        </div>
                        <div className="text-right text-sm font-semibold text-[#D4AF37] shrink-0">
                          {opt.isCostToBeArranged
                            ? 'A combinar'
                            : formatCurrencyBRL(opt.shippingCostCents)}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Campos de Endereço Revisáveis */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="sm:col-span-2">
              <label htmlFor="checkout-street" className="block text-xs text-[#A8A29E] mb-1">
                Rua / Logradouro *
              </label>
              <input
                id="checkout-street"
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkout-number" className="block text-xs text-[#A8A29E] mb-1">
                Número *
              </label>
              <input
                id="checkout-number"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkout-comp" className="block text-xs text-[#A8A29E] mb-1">
                Complemento
              </label>
              <input
                id="checkout-comp"
                type="text"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkout-neigh" className="block text-xs text-[#A8A29E] mb-1">
                Bairro / Distrito *
              </label>
              <input
                id="checkout-neigh"
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="checkout-city" className="block text-xs text-[#A8A29E] mb-1">
                Município / UF *
              </label>
              <div className="flex gap-2">
                <input
                  id="checkout-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="flex-1 min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
                <input
                  type="text"
                  maxLength={2}
                  aria-label="UF"
                  value={stateUf}
                  onChange={(e) => setStateUf(e.target.value.toUpperCase())}
                  className="w-14 min-h-[44px] text-center rounded-lg border border-[#262626] bg-[#0A0A0A] text-sm"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. Dados da Cliente */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            3. Identificação da Cliente
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="cust-name" className="block text-xs text-[#A8A29E] mb-1">
                Nome Completo *
              </label>
              <input
                id="cust-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="cust-cpf" className="block text-xs text-[#A8A29E] mb-1">
                CPF (para nota/envio) *
              </label>
              <input
                id="cust-cpf"
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                aria-invalid={cpfInvalid}
                aria-describedby={cpfInvalid ? 'cpf-error-msg' : undefined}
                placeholder="000.000.000-00"
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
              {cpfInvalid && (
                <span id="cpf-error-msg" className="text-xs text-[#EF4444] mt-1 block">
                  Informe um CPF válido de 11 dígitos.
                </span>
              )}
            </div>

            <div>
              <label htmlFor="cust-email" className="block text-xs text-[#A8A29E] mb-1">
                E-mail *
              </label>
              <input
                id="cust-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>

            <div>
              <label htmlFor="cust-phone" className="block text-xs text-[#A8A29E] mb-1">
                Telefone / WhatsApp com DDD *
              </label>
              <input
                id="cust-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phoneWhatsapp}
                onChange={(e) => setPhoneWhatsapp(e.target.value)}
                placeholder="(27) 99999-9999"
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Coluna Direita (5 cols): Escolha de Pagamento e Resumo Financeiro Server-Side */}
      <div className="lg:col-span-5 space-y-6">
        <section className="rounded-xl border border-[#D4AF37]/50 bg-[#141414] p-5 sm:p-6 space-y-5 sticky top-28">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            4. Forma de Pagamento e Totais (Cálculo no Servidor)
          </h2>

          {/* Seleção PIX vs Cartão */}
          <div className="space-y-2.5" role="radiogroup" aria-label="Forma de pagamento">
            <label
              className={`flex items-center justify-between rounded-lg border p-4 cursor-pointer transition ${
                paymentMethod === 'PIX'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15'
                  : 'border-[#262626] bg-[#0A0A0A]'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'PIX'}
                  onChange={() => {
                    setPaymentMethod('PIX');
                    setInstallments(1);
                  }}
                  className="accent-[#D4AF37]"
                />
                <div>
                  <strong className="text-sm text-[#F5F5F4] block">
                    PIX ({serverQuote?.pixDiscountPercentConfigured ?? initialPixDiscountPercent}% de
                    Desconto)
                  </strong>
                  <span className="text-xs text-[#10B981]">
                    Desconto aplicado automaticamente no cálculo do servidor
                  </span>
                </div>
              </div>
            </label>

            <label
              className={`flex items-center justify-between rounded-lg border p-4 cursor-pointer transition ${
                paymentMethod === 'CREDIT_CARD'
                  ? 'border-[#D4AF37] bg-[#D4AF37]/15'
                  : 'border-[#262626] bg-[#0A0A0A]'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'CREDIT_CARD'}
                  onChange={() => setPaymentMethod('CREDIT_CARD')}
                  className="accent-[#D4AF37]"
                />
                <div>
                  <strong className="text-sm text-[#F5F5F4] block">
                    Cartão de Crédito (até{' '}
                    {serverQuote?.maxInstallmentsAllowed ?? initialMaxInstallments}x)
                  </strong>
                  <span className="text-xs text-[#A8A29E]">Processamento via InfinitePay</span>
                </div>
              </div>
            </label>
          </div>

          {paymentMethod === 'CREDIT_CARD' && (
            <div>
              <label htmlFor="checkout-inst" className="block text-xs text-[#A8A29E] mb-1">
                Número de Parcelas
              </label>
              <select
                id="checkout-inst"
                value={installments}
                onChange={(e) => setInstallments(Number(e.target.value))}
                className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              >
                {Array.from(
                  { length: serverQuote?.maxInstallmentsAllowed ?? initialMaxInstallments },
                  (_, i) => i + 1
                ).map((n) => {
                  const totalCard =
                    (serverQuote?.subtotalCents ?? 0) + (serverQuote?.shippingCents ?? 0);
                  const perInst = Math.ceil(totalCard / n);
                  return (
                    <option key={n} value={n}>
                      {n}x de {formatCurrencyBRL(perInst)}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {quoteError && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/10 p-3 text-xs text-[#EF4444]"
            >
              {quoteError}
            </div>
          )}

          {/* Demonstrativo Financeiro Server-Side */}
          {serverQuote && (
            <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between text-[#A8A29E]">
                <span>Subtotal dos Produtos:</span>
                <span className="text-[#F5F5F4]">
                  {formatCurrencyBRL(serverQuote.subtotalCents)}
                </span>
              </div>

              {serverQuote.discountCents > 0 && (
                <div className="flex justify-between text-[#10B981]">
                  <span>Desconto PIX ({serverQuote.pixDiscountPercentApplied}%):</span>
                  <span>- {formatCurrencyBRL(serverQuote.discountCents)}</span>
                </div>
              )}

              <div className="flex justify-between text-[#A8A29E]">
                <span>Frete / Entrega:</span>
                <span className="text-[#F5F5F4]">
                  {!serverQuote.selectedShippingOption
                    ? 'Informe o CEP acima'
                    : serverQuote.selectedShippingOption.isCostToBeArranged
                    ? 'A combinar (Município próximo)'
                    : formatCurrencyBRL(serverQuote.shippingCents)}
                </span>
              </div>

              <div className="border-t border-[#262626] pt-2.5 flex justify-between items-baseline">
                <strong className="text-base text-[#F5F5F4]">Total Validado:</strong>
                <strong className="text-xl text-[#D4AF37]">
                  {calculating ? 'Calculando...' : formatCurrencyBRL(serverQuote.totalCents)}
                </strong>
              </div>
            </div>
          )}

          {/* Observações opcionais da cliente */}
          <div>
            <label htmlFor="checkout-notes" className="block text-xs text-[#A8A29E] mb-1">
              Observações do Pedido / Entrega (Opcional)
            </label>
            <input
              id="checkout-notes"
              type="text"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              placeholder="Ex.: Melhor horário para entrega em Domingos Martins"
              className="w-full min-h-[44px] rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
            />
          </div>

          {/* Ciência obrigatória para itens Sob Encomenda / Remessa Única */}
          {serverQuote?.hasMadeToOrderItems && (
            <label className="flex items-start gap-3 rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3.5 text-xs text-[#F5F5F4] cursor-pointer">
              <input
                type="checkbox"
                checked={agreedToMadeToOrderTerms}
                onChange={(e) => setAgreedToMadeToOrderTerms(e.target.checked)}
                className="mt-0.5 accent-[#D4AF37] w-4 h-4 shrink-0"
              />
              <span>
                Confirmo ciência de que este pedido inclui item(ns){' '}
                <strong className="text-[#D4AF37]">Sob Encomenda</strong> e que todos os produtos
                serão enviados juntos em <strong className="text-[#D4AF37]">remessa única</strong>{' '}
                após o prazo de preparação.
              </span>
            </label>
          )}

          {submitError && (
            <div
              role="alert"
              className="rounded-lg border border-[#EF4444]/50 bg-[#EF4444]/10 p-3.5 text-xs text-[#EF4444]"
            >
              {submitError}
            </div>
          )}

          {/* Botões de Conclusão (Site vs Atendimento Assistido WhatsApp) */}
          <div className="space-y-3 pt-1">
            <button
              type="button"
              disabled={submittingChannel !== null || calculating}
              onClick={() => handleCreateOrder('SITE_CHECKOUT')}
              className="w-full min-h-[48px] rounded-lg bg-[#D4AF37] hover:bg-[#C5A059] disabled:opacity-50 text-[#0A0A0A] text-sm font-bold tracking-wide transition cursor-pointer"
            >
              {submittingChannel === 'SITE_CHECKOUT'
                ? 'Registrando Pedido e Reservando Estoque...'
                : 'Finalizar Pedido no Site (Reserva de 30 min)'}
            </button>

            <button
              type="button"
              disabled={submittingChannel !== null || calculating}
              onClick={() => handleCreateOrder('WHATSAPP_ASSISTED')}
              className="w-full min-h-[48px] rounded-lg border border-[#D4AF37] bg-[#0A0A0A] hover:bg-[#D4AF37]/10 disabled:opacity-50 text-[#D4AF37] text-sm font-semibold transition cursor-pointer"
            >
              {submittingChannel === 'WHATSAPP_ASSISTED'
                ? 'Gerando Protocolo para WhatsApp...'
                : 'Concluir / Atender via WhatsApp (Gera Protocolo #SA)'}
            </button>

            <p className="text-[11px] text-[#A8A29E] text-center">
              O redirecionamento para o WhatsApp gera seu protocolo no sistema como{' '}
              <strong className="text-[#F5F5F4]">Encaminhado via WhatsApp</strong> e não é
              registrado como pago até a confirmação efetiva do pagamento.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
