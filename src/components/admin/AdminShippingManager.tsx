'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export interface MunicipalityDTO {
  id: string;
  cityName: string;
  stateUf: string;
  cepStart: string;
  cepEnd: string;
  allowArrangedDelivery: boolean;
  fixedFeeCents: number | null;
  deliveryNotes: string;
  isActive: boolean;
}

export interface StoreSettingsDTO {
  originCep: string;
  pixDiscountPercent: number;
  maxInstallments: number;
  whatsappNumber: string;
}

interface Props {
  adminEmail: string;
  adminRole: string;
  settings: StoreSettingsDTO;
  municipalities: MunicipalityDTO[];
}

export default function AdminShippingManager({
  adminEmail,
  adminRole,
  settings,
  municipalities,
}: Props) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Parâmetros gerais (CEP Origem, PIX %, Parcelas)
  const [originCep, setOriginCep] = useState(settings.originCep);
  const [pixDiscount, setPixDiscount] = useState(String(settings.pixDiscountPercent));
  const [maxInst, setMaxInst] = useState(String(settings.maxInstallments));

  // Novo Município Próximo
  const [cityName, setCityName] = useState('');
  const [stateUf, setStateUf] = useState('ES');
  const [cepStart, setCepStart] = useState('');
  const [cepEnd, setCepEnd] = useState('');
  const [fixedFeeReais, setFixedFeeReais] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const res = await fetch('/api/admin/municipalities', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: 'store_settings',
        originCep,
        pixDiscountPercent: Number(pixDiscount),
        maxInstallments: Number(maxInst),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao atualizar configurações.' });
      return;
    }

    setFeedback({ type: 'ok', text: 'Configurações de CEP de origem e pagamento salvas.' });
    router.refresh();
  }

  async function handleAddMunicipality(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const fixedFeeCents =
      fixedFeeReais.trim() !== ''
        ? Math.round(Number(fixedFeeReais.replace(',', '.')) * 100)
        : null;

    const res = await fetch('/api/admin/municipalities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cityName,
        stateUf,
        cepStart,
        cepEnd,
        allowArrangedDelivery: true,
        fixedFeeCents,
        deliveryNotes,
        isActive: true,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao salvar município próximo.' });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Município "${data.municipality.cityName}" adicionado à regra de Entrega a Combinar.`,
    });
    setCityName('');
    setCepStart('');
    setCepEnd('');
    setFixedFeeReais('');
    setDeliveryNotes('');
    router.refresh();
  }

  async function handleToggleMunicipality(id: string, nextActive: boolean) {
    setFeedback(null);
    const res = await fetch('/api/admin/municipalities', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isActive: nextActive }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4]">
      <header className="border-b border-[#262626] bg-[#141414]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
              Administração • Entregas &amp; Frete
            </span>
            <h1 className="text-xl font-serif tracking-[0.15em] text-[#D4AF37] font-semibold">
              STILLUS ALBAN — ENTREGAS E FRETE
            </h1>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span className="text-[#A8A29E]">
              {adminEmail} (<strong className="text-[#D4AF37]">{adminRole}</strong>)
            </span>
            <Link
              href="/admin"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded border border-[#D4AF37] bg-[#0A0A0A] text-[#D4AF37]"
            >
              Voltar a Produtos e Estoque
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {feedback && (
          <div
            role="alert"
            className={`rounded-lg border p-4 text-sm ${
              feedback.type === 'ok'
                ? 'border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
                : 'border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Formulário de Configurações Gerais (CEP Origem e Desconto PIX) */}
          <form
            onSubmit={handleSaveSettings}
            className="rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4 h-fit"
          >
            <h2 className="text-base font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
              A. Parâmetros de Origem e Desconto PIX
            </h2>

            <div>
              <label htmlFor="set-cep" className="block text-xs text-[#A8A29E] mb-1">
                CEP de Origem (Domingos Martins/ES) *
              </label>
              <input
                id="set-cep"
                type="text"
                required
                value={originCep}
                onChange={(e) => setOriginCep(e.target.value)}
                className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="set-pix" className="block text-xs text-[#A8A29E] mb-1">
                  Desconto PIX (%) *
                </label>
                <input
                  id="set-pix"
                  type="number"
                  step="0.5"
                  min="0"
                  max="50"
                  required
                  value={pixDiscount}
                  onChange={(e) => setPixDiscount(e.target.value)}
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="set-inst" className="block text-xs text-[#A8A29E] mb-1">
                  Máx. Parcelas *
                </label>
                <input
                  id="set-inst"
                  type="number"
                  min="1"
                  max="12"
                  required
                  value={maxInst}
                  onChange={(e) => setMaxInst(e.target.value)}
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full min-h-[44px] rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-semibold text-sm cursor-pointer"
            >
              Salvar Parâmetros
            </button>
          </form>

          {/* Formulário: Adicionar Município Próximo à Lista Editável */}
          <form
            onSubmit={handleAddMunicipality}
            className="lg:col-span-2 rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-[#D4AF37] border-b border-[#262626] pb-2">
              B. Adicionar Município Próximo (Regra &ldquo;Entrega a Combinar&rdquo;)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="mun-city" className="block text-xs text-[#A8A29E] mb-1">
                  Nome do Município *
                </label>
                <input
                  id="mun-city"
                  type="text"
                  required
                  value={cityName}
                  onChange={(e) => setCityName(e.target.value)}
                  placeholder="Ex.: Santa Maria de Jetibá"
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="mun-uf" className="block text-xs text-[#A8A29E] mb-1">
                  UF *
                </label>
                <input
                  id="mun-uf"
                  type="text"
                  maxLength={2}
                  required
                  value={stateUf}
                  onChange={(e) => setStateUf(e.target.value.toUpperCase())}
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="mun-start" className="block text-xs text-[#A8A29E] mb-1">
                  CEP Inicial (8 dígitos) *
                </label>
                <input
                  id="mun-start"
                  type="text"
                  required
                  value={cepStart}
                  onChange={(e) => setCepStart(e.target.value)}
                  placeholder="29645000"
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="mun-end" className="block text-xs text-[#A8A29E] mb-1">
                  CEP Final (8 dígitos) *
                </label>
                <input
                  id="mun-end"
                  type="text"
                  required
                  value={cepEnd}
                  onChange={(e) => setCepEnd(e.target.value)}
                  placeholder="29649999"
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="mun-fee" className="block text-xs text-[#A8A29E] mb-1">
                  Taxa Fixa Opcional (R$)
                </label>
                <input
                  id="mun-fee"
                  type="text"
                  value={fixedFeeReais}
                  onChange={(e) => setFixedFeeReais(e.target.value)}
                  placeholder="Vazio = A combinar"
                  className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="mun-notes" className="block text-xs text-[#A8A29E] mb-1">
                Instruções Exibidas no Checkout *
              </label>
              <input
                id="mun-notes"
                type="text"
                required
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder="Ex.: Entrega combinada via WhatsApp após confirmação do pedido"
                className="w-full min-h-[42px] rounded border border-[#262626] bg-[#0A0A0A] px-3 text-sm"
              />
            </div>

            <button
              type="submit"
              className="min-h-[44px] px-6 py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-semibold text-sm cursor-pointer"
            >
              Adicionar Município à Lista
            </button>
          </form>
        </div>

        {/* Lista Editável de Municípios Cadastrados */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[#D4AF37]">
            Municípios Cadastrados na Regra de Entrega Regional ({municipalities.length})
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {municipalities.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <strong className="text-sm text-[#F5F5F4]">
                      {m.cityName} — {m.stateUf}
                    </strong>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        m.isActive
                          ? 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30'
                          : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30'
                      }`}
                    >
                      {m.isActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-xs text-[#A8A29E] mt-1">
                    Faixa de CEP: {m.cepStart} a {m.cepEnd}
                  </p>
                  <p className="text-xs text-[#C5A059] mt-1">{m.deliveryNotes}</p>
                </div>

                <div className="pt-3 border-t border-[#262626] flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleToggleMunicipality(m.id, !m.isActive)}
                    className="min-h-[36px] px-3 py-1 rounded border border-[#262626] bg-[#141414] hover:border-[#D4AF37] text-xs text-[#F5F5F4] cursor-pointer"
                  >
                    {m.isActive ? 'Desativar Município' : 'Ativar Município'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
