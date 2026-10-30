import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import StoreHeader from '@/components/storefront/StoreHeader';
import OrderPaymentSection from '@/components/storefront/OrderPaymentSection';
import { formatCurrencyBRL } from '@/lib/storefront';
import {
  buildInfinitePayCheckoutUrl,
  buildWhatsAppOrderMessage,
  releaseExpiredOrderReservations,
} from '@/lib/orders';

export const dynamic = 'force-dynamic';

const ORDER_STATUS_LABELS: Record<string, { label: string; badgeClass: string; desc: string }> = {
  ENCAMINHADO_WHATSAPP: {
    label: 'Encaminhado ao WhatsApp (Não Pago)',
    badgeClass: 'border-[#F59E0B] bg-[#F59E0B]/15 text-[#F59E0B]',
    desc: 'Seu protocolo foi registrado para atendimento assistido via WhatsApp. Este pedido ainda NÃO consta como pago até a confirmação efetiva do pagamento.',
  },
  AGUARDANDO_PAGAMENTO: {
    label: 'Pedido Criado • Aguardando Pagamento',
    badgeClass: 'border-[#D4AF37] bg-[#D4AF37]/15 text-[#D4AF37]',
    desc: 'Seu pedido foi registrado e o estoque físico foi reservado temporariamente. O pedido avançará para preparação assim que o pagamento for confirmado.',
  },
  PAGO_EM_PREPARACAO: {
    label: 'Pagamento Confirmado • Em Preparação',
    badgeClass: 'border-[#10B981] bg-[#10B981]/15 text-[#10B981]',
    desc: 'Pagamento confirmado! Seus itens estão em separação/preparação conforme o prazo informado.',
  },
  PRONTO_PARA_ENVIO: {
    label: 'Pronto para Envio / Entrega',
    badgeClass: 'border-[#10B981] bg-[#10B981]/15 text-[#10B981]',
    desc: 'Seu pedido está pronto para despacho ou entrega combinada.',
  },
  ENVIADO: {
    label: 'Pedido Enviado',
    badgeClass: 'border-[#10B981] bg-[#10B981]/20 text-[#10B981]',
    desc: 'Seu pedido foi despachado. Confira o código de rastreio abaixo.',
  },
  ENTREGUE: {
    label: 'Pedido Entregue',
    badgeClass: 'border-[#10B981] bg-[#10B981]/20 text-[#10B981]',
    desc: 'Pedido entregue com sucesso.',
  },
  CANCELADO: {
    label: 'Pedido Cancelado / Reserva Expirada',
    badgeClass: 'border-[#EF4444] bg-[#EF4444]/15 text-[#EF4444]',
    desc: 'Este pedido foi cancelado ou teve o prazo de reserva expirado sem confirmação de pagamento.',
  },
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NAO_INICIADO: 'Não Iniciado (Atendimento WhatsApp)',
  PENDENTE: 'Aguardando Confirmação de Pagamento',
  CONFIRMADO: 'Pagamento Confirmado',
  FALHOU: 'Não Concluído / Expirado',
  REEMBOLSADO: 'Reembolsado',
};

export default async function OrderProtocolPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  await releaseExpiredOrderReservations();
  const { numero } = await params;

  const [order, settings, categories] = await Promise.all([
    prisma.order.findUnique({
      where: { orderNumber: numero },
      include: {
        customer: true,
        items: true,
        shipping: true,
        payments: true,
      },
    }),
    prisma.storeSettings.findUnique({ where: { id: 'default' } }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
  ]);

  if (!order) {
    notFound();
  }

  const statusMeta = ORDER_STATUS_LABELS[order.orderStatus] || {
    label: order.orderStatus,
    badgeClass: 'border-[#262626] bg-[#141414] text-[#F5F5F4]',
    desc: '',
  };

  const ipCheckout = buildInfinitePayCheckoutUrl({
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    customerName: order.customer.fullName,
    customerEmail: order.customer.email,
    customerPhone: order.customer.phoneWhatsapp,
    items: order.items,
  });

  const shippingDescription = order.shipping
    ? `${order.shipping.serviceName} (${order.shipping.carrierName}) — CEP ${order.shipping.cep} (${order.shipping.city}/${order.shipping.state})`
    : 'A combinar';

  const whatsappMessage = buildWhatsAppOrderMessage({
    orderNumber: order.orderNumber,
    customerName: order.customer.fullName,
    items: order.items,
    shippingDescription,
    paymentMethod: order.paymentMethodChosen,
    installments: order.installments,
    totalCents: order.totalCents,
  });

  const storeWhatsappDigits = (
    settings?.whatsappNumber ||
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ||
    ''
  ).replace(/\D/g, '');

  const whatsappDeepLink = storeWhatsappDigits
    ? `https://wa.me/${storeWhatsappDigits}?text=${encodeURIComponent(whatsappMessage)}`
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0A] text-[#F5F5F4]">
      <StoreHeader categories={categories} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Cabeçalho do Protocolo e Distinção Clara de Estado */}
        <section className="rounded-xl border border-[#D4AF37]/50 bg-[#141414] p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626] pb-4">
            <div>
              <span className="text-xs uppercase tracking-[0.2em] text-[#C5A059] block">
                Protocolo Oficial do Pedido
              </span>
              <h1 className="text-2xl sm:text-3xl font-serif text-[#D4AF37] font-semibold">
                #{order.orderNumber}
              </h1>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <span
                className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-semibold border ${statusMeta.badgeClass}`}
              >
                {statusMeta.label}
              </span>
              <span className="text-xs text-[#A8A29E]">
                Situação Financeira:{' '}
                <strong className="text-[#F5F5F4]">
                  {PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus}
                </strong>
              </span>
            </div>
          </div>

          <p className="text-sm text-[#A8A29E] leading-relaxed">{statusMeta.desc}</p>

          {order.stockReservationExpiresAt && order.paymentStatus !== 'CONFIRMADO' && (
            <div className="rounded-lg border border-[#D4AF37]/40 bg-[#0A0A0A] p-3 text-xs text-[#C5A059]">
              Reserva temporária de estoque ativa até:{' '}
              <strong className="text-[#F5F5F4]">
                {new Date(order.stockReservationExpiresAt).toLocaleString('pt-BR')}
              </strong>
              .
            </div>
          )}

          {order.shipping?.trackingCode && (
            <div className="rounded-lg border border-[#10B981]/50 bg-[#10B981]/10 p-3.5 text-xs text-[#10B981]">
              Código de Rastreio do Envio:{' '}
              <strong className="text-sm underline">{order.shipping.trackingCode}</strong>
            </div>
          )}
        </section>

        {/* Bloco de Ação de Pagamento (Mercado Pago / WhatsApp) */}
        {order.paymentStatus !== 'CONFIRMADO' && order.orderStatus !== 'CANCELADO' && (
          <OrderPaymentSection
            orderNumber={order.orderNumber}
            totalCents={order.totalCents}
            paymentMethodChosen={order.paymentMethodChosen}
            installments={order.installments}
            paymentStatus={order.paymentStatus}
            mpTransaction={order.payments[0] || null}
            whatsappDeepLink={whatsappDeepLink}
            whatsappMessage={whatsappMessage}
          />
        )}

        {/* Itens do Pedido */}
        <section className="rounded-xl border border-[#262626] bg-[#141414] p-6 space-y-4">
          <h2 className="text-lg font-serif text-[#D4AF37] font-semibold border-b border-[#262626] pb-3">
            Itens do Pedido
          </h2>

          {order.hasMadeToOrderItems && (
            <div className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3 text-xs text-[#F5F5F4]">
              <strong className="text-[#D4AF37]">Regra de Envio em Remessa Única:</strong> Este
              pedido inclui item(ns) sob encomenda. Todos os produtos serão despachados juntos após
              o prazo de preparação ({order.maxPrepDays} dia(s) útil(is)).
            </div>
          )}

          <div className="space-y-3">
            {order.items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-[#262626] bg-[#0A0A0A] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <strong className="text-sm text-[#F5F5F4] block">
                    {item.quantity}x {item.snapshotProductName}
                  </strong>
                  <div className="text-[#A8A29E]">
                    SKU: <strong className="text-[#D4AF37]">{item.snapshotSkuCode}</strong> • Cor:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotColorName}</strong> • Modelo:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotModelName}</strong> • Tam:{' '}
                    <strong className="text-[#F5F5F4]">{item.snapshotSizeLabel}</strong>
                  </div>
                  <span className="inline-block text-[11px] text-[#C5A059]">
                    Modalidade:{' '}
                    {item.snapshotSupplyMode === 'IN_STOCK'
                      ? 'Estoque Próprio'
                      : item.snapshotSupplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD'
                      ? `Sob Encomenda (${item.snapshotPrepDays} dias úteis)`
                      : 'Sob Encomenda (Prazo a confirmar)'}
                  </span>
                </div>

                <div className="text-right">
                  <strong className="text-sm text-[#D4AF37] block">
                    {formatCurrencyBRL(item.lineTotalCents)}
                  </strong>
                  <span className="text-[11px] text-[#A8A29E]">
                    {formatCurrencyBRL(item.unitPriceCents)} / un.
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Resumo Financeiro e Entrega */}
          <div className="border-t border-[#262626] pt-4 grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
            <div className="space-y-1 text-[#A8A29E]">
              <strong className="text-[#F5F5F4] block mb-1">Dados de Entrega Registrados:</strong>
              <p>Destinatário(a): {order.shipping?.recipientName || order.customer.fullName}</p>
              {order.shipping && (
                <>
                  <p>
                    {order.shipping.street}, {order.shipping.number}
                    {order.shipping.complement ? ` (${order.shipping.complement})` : ''} —{' '}
                    {order.shipping.neighborhood}
                  </p>
                  <p>
                    {order.shipping.city}/{order.shipping.state} • CEP {order.shipping.cep}
                  </p>
                  <p className="text-[#C5A059] pt-1">
                    Modalidade: {order.shipping.serviceName} ({order.shipping.carrierName})
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5 rounded-lg border border-[#262626] bg-[#0A0A0A] p-4">
              <div className="flex justify-between text-[#A8A29E]">
                <span>Subtotal:</span>
                <span className="text-[#F5F5F4]">{formatCurrencyBRL(order.subtotalCents)}</span>
              </div>
              {order.discountCents > 0 && (
                <div className="flex justify-between text-[#10B981]">
                  <span>Desconto PIX ({order.pixDiscountPercentApplied}%):</span>
                  <span>- {formatCurrencyBRL(order.discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-[#A8A29E]">
                <span>Frete:</span>
                <span className="text-[#F5F5F4]">
                  {order.shipping?.shippingMode === 'MUNICIPIO_PROXIMO_A_COMBINAR' &&
                  order.shippingCents === 0
                    ? 'A combinar'
                    : formatCurrencyBRL(order.shippingCents)}
                </span>
              </div>
              <div className="border-t border-[#262626] pt-2 flex justify-between items-baseline">
                <strong className="text-sm text-[#F5F5F4]">Total do Pedido:</strong>
                <strong className="text-lg text-[#D4AF37]">
                  {formatCurrencyBRL(order.totalCents)}
                </strong>
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-between items-center pt-2">
          <Link
            href="/produtos"
            className="text-xs text-[#C5A059] hover:text-[#D4AF37] underline"
          >
            ← Voltar ao Catálogo
          </Link>
        </div>
      </main>
    </div>
  );
}
