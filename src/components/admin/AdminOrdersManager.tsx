'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrencyBRL } from '@/lib/storefront';

export interface AdminOrderItemDTO {
  id: string;
  snapshotProductName: string;
  snapshotSkuCode: string;
  snapshotColorName: string;
  snapshotModelName: string;
  snapshotSizeLabel: string;
  snapshotSupplyMode: string;
  snapshotPrepDays: number | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface AdminOrderDTO {
  id: string;
  orderNumber: string;
  channel: string;
  orderStatus: string;
  paymentStatus: string;
  paymentMethodChosen: string;
  installments: number;
  hasMadeToOrderItems: boolean;
  maxPrepDays: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  customer: {
    fullName: string;
    cpf: string;
    email: string;
    phoneWhatsapp: string;
  };
  items: AdminOrderItemDTO[];
  shipping: {
    shippingMode: string;
    carrierName: string;
    serviceName: string;
    cep: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    trackingCode: string | null;
  } | null;
}

interface Props {
  adminEmail: string;
  adminRole: string;
  initialOrders: AdminOrderDTO[];
}

export default function AdminOrdersManager({
  adminEmail,
  adminRole,
  initialOrders,
}: Props) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [manualReasonByOrder, setManualReasonByOrder] = useState<Record<string, string>>({});
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});
  const [statusByOrder, setStatusByOrder] = useState<Record<string, string>>({});

  async function handleConfirmPayment(orderId: string, orderNumber: string) {
    setFeedback(null);
    const reason = manualReasonByOrder[orderId] || '';

    const res = await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'confirm_manual_payment',
        orderId,
        reason,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao confirmar pagamento.' });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Pagamento do pedido #${orderNumber} confirmado com baixa de estoque auditada.`,
    });
    router.refresh();
  }

  async function handleUpdateStatus(order: AdminOrderDTO) {
    setFeedback(null);
    const nextStatus = statusByOrder[order.id] ?? order.orderStatus;
    const nextTracking =
      trackingByOrder[order.id] !== undefined
        ? trackingByOrder[order.id]
        : order.shipping?.trackingCode || '';

    const res = await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_operational_status',
        orderId: order.id,
        orderStatus: nextStatus,
        trackingCode: nextTracking || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setFeedback({ type: 'err', text: data.error || 'Erro ao atualizar status.' });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Pedido #${order.orderNumber} atualizado para ${nextStatus}.`,
    });
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4]">
      <header className="border-b border-[#262626] bg-[#141414]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
              Administração • Pedidos &amp; Pagamentos
            </span>
            <h1 className="text-xl font-serif tracking-[0.15em] text-[#D4AF37] font-semibold">
              STILLUS ALBAN — GESTÃO DE PEDIDOS
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-[#A8A29E]">
              {adminEmail} (<strong className="text-[#D4AF37]">{adminRole}</strong>)
            </span>
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
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {feedback && (
          <div
            role="alert"
            className={`rounded-lg p-4 text-sm border ${
              feedback.type === 'ok'
                ? 'border-[#10B981]/50 bg-[#10B981]/10 text-[#10B981]'
                : 'border-[#EF4444]/50 bg-[#EF4444]/10 text-[#EF4444]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {initialOrders.length === 0 ? (
          <section className="rounded-xl border border-[#262626] bg-[#141414] p-8 text-center text-sm text-[#A8A29E]">
            Nenhum pedido registrado até o momento.
          </section>
        ) : (
          <div className="space-y-4">
            {initialOrders.map((order) => (
              <section
                key={order.id}
                className="rounded-xl border border-[#262626] bg-[#141414] p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#262626] pb-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/pedido/${order.orderNumber}`}
                        className="text-lg font-serif text-[#D4AF37] font-semibold hover:underline"
                      >
                        #{order.orderNumber}
                      </Link>
                      <span className="text-xs px-2.5 py-0.5 rounded border border-[#262626] bg-[#0A0A0A] text-[#C5A059]">
                        {order.channel === 'SITE_CHECKOUT'
                          ? 'Checkout Site'
                          : 'Encaminhado WhatsApp'}
                      </span>
                    </div>
                    <p className="text-xs text-[#A8A29E] mt-1">
                      Cliente: <strong className="text-[#F5F5F4]">{order.customer.fullName}</strong>{' '}
                      • WhatsApp: {order.customer.phoneWhatsapp} • Criado em{' '}
                      {new Date(order.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>

                  <div className="text-left sm:text-right text-xs space-y-1">
                    <div>
                      Status Operacional:{' '}
                      <strong className="text-[#D4AF37]">{order.orderStatus}</strong>
                    </div>
                    <div>
                      Status Pagamento:{' '}
                      <strong
                        className={
                          order.paymentStatus === 'CONFIRMADO'
                            ? 'text-[#10B981]'
                            : 'text-[#F59E0B]'
                        }
                      >
                        {order.paymentStatus}
                      </strong>{' '}
                      ({order.paymentMethodChosen} • {formatCurrencyBRL(order.totalCents)})
                    </div>
                  </div>
                </div>

                {/* Lista de Itens do Pedido (Snapshot Imutável) */}
                <div className="space-y-1.5 text-xs">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded border border-[#262626] bg-[#0A0A0A] px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        <strong>{item.quantity}x</strong> {item.snapshotProductName} • SKU:{' '}
                        <strong className="text-[#D4AF37]">{item.snapshotSkuCode}</strong> (
                        {item.snapshotColorName} / {item.snapshotModelName} / Tam{' '}
                        {item.snapshotSizeLabel}) [{item.snapshotSupplyMode}]
                      </span>
                      <strong className="text-[#D4AF37]">
                        {formatCurrencyBRL(item.lineTotalCents)}
                      </strong>
                    </div>
                  ))}
                </div>

                {/* Controles de Operação e Confirmação Manual Auditada */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-[#262626]">
                  {/* 1. Atualizar Status Operacional e Código de Rastreio */}
                  <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3.5 space-y-3">
                    <span className="text-xs font-semibold text-[#C5A059] block">
                      Atualizar Status Operacional e Rastreio
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        aria-label={`Status do pedido ${order.orderNumber}`}
                        value={statusByOrder[order.id] ?? order.orderStatus}
                        onChange={(e) =>
                          setStatusByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                        className="min-h-[40px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs"
                      >
                        <option value="ENCAMINHADO_WHATSAPP">ENCAMINHADO_WHATSAPP</option>
                        <option value="AGUARDANDO_PAGAMENTO">AGUARDANDO_PAGAMENTO</option>
                        <option value="PAGO_EM_PREPARACAO">PAGO_EM_PREPARACAO</option>
                        <option value="PRONTO_PARA_ENVIO">PRONTO_PARA_ENVIO</option>
                        <option value="ENVIADO">ENVIADO</option>
                        <option value="ENTREGUE">ENTREGUE</option>
                        <option value="CANCELADO">CANCELADO (Libera reserva)</option>
                      </select>

                      <input
                        type="text"
                        placeholder="Código de Rastreio (Opcional)"
                        value={
                          trackingByOrder[order.id] !== undefined
                            ? trackingByOrder[order.id]
                            : order.shipping?.trackingCode || ''
                        }
                        onChange={(e) =>
                          setTrackingByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                        className="min-h-[40px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(order)}
                      className="min-h-[38px] px-4 py-1.5 rounded bg-[#D4AF37] text-[#0A0A0A] text-xs font-semibold cursor-pointer"
                    >
                      Salvar Status / Rastreio
                    </button>
                  </div>

                  {/* 2. Confirmação Manual de Pagamento (com Auditoria e Baixa Atômica) */}
                  {order.paymentStatus !== 'CONFIRMADO' && order.orderStatus !== 'CANCELADO' && (
                    <div className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-3.5 space-y-3">
                      <span className="text-xs font-semibold text-[#10B981] block">
                        Confirmar Pagamento Recebido (Baixa Atômica de Estoque)
                      </span>
                      <input
                        type="text"
                        placeholder="Motivo / NSU / Comprovante PIX conferido *"
                        value={manualReasonByOrder[order.id] || ''}
                        onChange={(e) =>
                          setManualReasonByOrder((prev) => ({
                            ...prev,
                            [order.id]: e.target.value,
                          }))
                        }
                        className="w-full min-h-[40px] rounded border border-[#262626] bg-[#141414] px-2.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleConfirmPayment(order.id, order.orderNumber)}
                        className="min-h-[38px] px-4 py-1.5 rounded bg-[#10B981] text-[#0A0A0A] text-xs font-semibold cursor-pointer"
                      >
                        Confirmar Pagamento e Baixar Estoque
                      </button>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
