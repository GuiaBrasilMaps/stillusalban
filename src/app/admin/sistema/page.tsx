import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerAdminSession } from '@/lib/admin-session';
import { evaluateOperationalReadiness } from '@/lib/operational-readiness';

export const dynamic = 'force-dynamic';

export default async function AdminSystemReadinessPage() {
  const session = await getServerAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  const [readiness, recentAudits] = await Promise.all([
    evaluateOperationalReadiness(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        actor: {
          select: { name: true, email: true, role: true },
        },
      },
    }),
  ]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4]">
      <header className="border-b border-[#262626] bg-[#141414]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
              Administração • Sistema &amp; Auditoria
            </span>
            <h1 className="text-xl font-serif tracking-[0.15em] text-[#D4AF37] font-semibold">
              STILLUS ALBAN — DIAGNÓSTICO &amp; AUDITORIA
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <Link
              href="/admin"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              ← Catálogo e Estoque
            </Link>
            <Link
              href="/admin/entregas"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              Entregas Regionais
            </Link>
            <Link
              href="/admin/pedidos"
              className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded border border-[#262626] bg-[#0A0A0A] hover:border-[#D4AF37] text-[#F5F5F4]"
            >
              Pedidos
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Status Honesto de Integrações e Credenciais */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            1. Status Real das Integrações Externas e Parâmetros da Loja
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Mercado Pago */}
            <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-sm text-[#F5F5F4]">Mercado Pago Gateway</strong>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    readiness.integrations.mercadoPago.status === 'PRONTO_PRODUCAO'
                      ? 'bg-[#10B981]/20 text-[#10B981]'
                      : readiness.integrations.mercadoPago.status === 'PRONTO_TESTE'
                      ? 'bg-[#3B82F6]/20 text-[#3B82F6]'
                      : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                  }`}
                >
                  {readiness.integrations.mercadoPago.status}
                </span>
              </div>
              <p className="text-[#A8A29E]">
                Modo: <strong className={readiness.integrations.mercadoPago.isSandbox ? 'text-[#3B82F6]' : 'text-[#10B981]'}>
                  {readiness.integrations.mercadoPago.isSandbox ? 'Sandbox (Testes Ativos)' : 'Produção Real'}
                </strong>
              </p>
              <p className="text-[#A8A29E]">
                PIX QrCode &amp; Checkout Pro: <strong className="text-[#F5F5F4]">Ativo no Site</strong>
              </p>
            </div>

            {/* Melhor Envio */}
            <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-sm text-[#F5F5F4]">Melhor Envio API v2</strong>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    readiness.integrations.melhorEnvio.tokenConfigured
                      ? 'bg-[#10B981]/20 text-[#10B981]'
                      : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                  }`}
                >
                  {readiness.integrations.melhorEnvio.status}
                </span>
              </div>
              <p className="text-[#A8A29E]">
                CEP de Origem Confirmado:{' '}
                <strong className="text-[#D4AF37]">{readiness.originCep}</strong>
              </p>
              <p className="text-[#A8A29E]">
                Municípios Entrega a Combinar:{' '}
                <strong className="text-[#F5F5F4]">
                  {readiness.activeNearbyMunicipalities.join(', ')}
                </strong>
              </p>
            </div>

            {/* InfinitePay */}
            <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-sm text-[#F5F5F4]">InfinitePay (PIX &amp; Cartão)</strong>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    readiness.integrations.infinitePay.handleConfigured
                      ? 'bg-[#10B981]/20 text-[#10B981]'
                      : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                  }`}
                >
                  {readiness.integrations.infinitePay.status}
                </span>
              </div>
              <p className="text-[#A8A29E]">
                Desconto PIX: <strong className="text-[#10B981]">{readiness.pixDiscountPercent}%</strong>{' '}
                • Parcelamento: <strong className="text-[#F5F5F4]">até {readiness.maxInstallments}x</strong>
              </p>
              <p className="text-[#A8A29E]">
                Webhook HMAC Secret:{' '}
                <strong className="text-[#F5F5F4]">
                  {readiness.integrations.infinitePay.webhookSecretConfigured
                    ? 'Configurado'
                    : 'Pendente no .env'}
                </strong>
              </p>
            </div>

            {/* Atendimento WhatsApp */}
            <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <strong className="text-sm text-[#F5F5F4]">Atendimento WhatsApp</strong>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    readiness.integrations.whatsapp.numberConfigured
                      ? 'bg-[#10B981]/20 text-[#10B981]'
                      : 'bg-[#F59E0B]/20 text-[#F59E0B]'
                  }`}
                >
                  {readiness.integrations.whatsapp.status}
                </span>
              </div>
              <p className="text-[#A8A29E]">
                Reserva de Estoque no Checkout:{' '}
                <strong className="text-[#D4AF37]">{readiness.stockReservationMinutes} min</strong>
              </p>
              <p className="text-[#A8A29E]">
                Produtos Ativos: <strong className="text-[#F5F5F4]">{readiness.activeProductsCount}</strong>
              </p>
            </div>
          </div>
        </section>

        {/* Trilha de Auditoria (AuditLog) */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            2. Trilha de Auditoria Recente (AuditLog)
          </h2>

          {recentAudits.length === 0 ? (
            <p className="text-xs text-[#A8A29E]">Nenhum evento de auditoria registrado.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {recentAudits.map((log) => (
                <div
                  key={log.id}
                  className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <strong className="text-[#D4AF37]">{log.action}</strong>{' '}
                    <span className="text-[#A8A29E]">
                      ({log.entityType} • ID: {log.entityId})
                    </span>
                    <div className="text-[11px] text-[#A8A29E]">
                      Ator:{' '}
                      {log.actor
                        ? `${log.actor.name} (${log.actor.email})`
                        : 'Sistema / Automático'}
                    </div>
                  </div>
                  <span className="text-[11px] text-[#A8A29E]">
                    {new Date(log.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
