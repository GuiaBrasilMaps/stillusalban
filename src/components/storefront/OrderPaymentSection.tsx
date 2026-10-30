'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrencyBRL } from '@/lib/storefront';

interface Props {
  orderNumber: string;
  totalCents: number;
  paymentMethodChosen: string;
  installments: number;
  paymentStatus: string;
  mpTransaction?: {
    provider: string;
    checkoutUrl: string | null;
    qrCode: string | null;
    qrCodeBase64: string | null;
    ticketUrl: string | null;
  } | null;
  whatsappDeepLink: string | null;
  whatsappMessage: string;
}

export default function OrderPaymentSection({
  orderNumber,
  totalCents,
  paymentMethodChosen,
  installments,
  paymentStatus,
  mpTransaction,
  whatsappDeepLink,
  whatsappMessage,
}: Props) {
  const router = useRouter();
  const [copiedPix, setCopiedPix] = useState(false);
  const [copiedWa, setCopiedWa] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);

  const isPix = paymentMethodChosen === 'PIX';
  const hasMpPix = Boolean(mpTransaction?.qrCode || mpTransaction?.qrCodeBase64);
  const hasMpCheckout = Boolean(mpTransaction?.checkoutUrl);

  async function handleCheckPayment() {
    setCheckingStatus(true);
    setCheckNotice(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/payment-status`);
      const data = await res.json();
      if (data.confirmed) {
        setCheckNotice('✓ Pagamento Confirmado com sucesso!');
        router.refresh();
      } else {
        setCheckNotice('Ainda aguardando confirmação da operadora. Se você já pagou, pode levar alguns segundos.');
      }
    } catch {
      setCheckNotice('Não foi possível verificar no momento. Tente novamente em instantes.');
    } finally {
      setCheckingStatus(false);
    }
  }

  function handleCopyPix() {
    if (!mpTransaction?.qrCode) return;
    navigator.clipboard?.writeText(mpTransaction.qrCode);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 3000);
  }

  return (
    <section className="rounded-2xl border border-[#D4AF37]/50 bg-[#141414] p-6 space-y-6 shadow-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#262626] pb-4">
        <div>
          <span className="text-xs uppercase tracking-widest text-[#C5A059] block font-semibold">
            Pagamento Seguro • Mercado Pago
          </span>
          <h2 className="text-xl font-serif text-[#F5F5F4] font-semibold mt-0.5">
            {isPix ? 'Pagar com PIX (10% de Desconto)' : `Pagar com Cartão (até ${installments}x)`}
          </h2>
        </div>

        <button
          type="button"
          disabled={checkingStatus}
          onClick={handleCheckPayment}
          className="min-h-[38px] px-4 py-1.5 rounded-lg border border-[#D4AF37]/50 bg-[#0A0A0A] hover:border-[#D4AF37] text-xs text-[#D4AF37] font-semibold cursor-pointer transition shrink-0"
        >
          {checkingStatus ? 'Verificando...' : '↻ Já paguei / Verificar'}
        </button>
      </div>

      {checkNotice && (
        <div
          role="status"
          className="rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 p-3 text-xs text-[#F5F5F4]"
        >
          {checkNotice}
        </div>
      )}

      {/* BLOCO PIX: QR CODE TRANSPARENTE E COPIA E COLA */}
      {isPix && hasMpPix && (
        <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-5 sm:p-6 space-y-5">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* QR Code Imagem Base64 */}
            {mpTransaction?.qrCodeBase64 ? (
              <div className="p-3 rounded-2xl bg-white border border-[#D4AF37]/40 shadow-lg shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${mpTransaction.qrCodeBase64}`}
                  alt="QR Code PIX Mercado Pago"
                  className="w-48 h-48 object-contain"
                />
              </div>
            ) : null}

            <div className="space-y-3 flex-1 text-center md:text-left">
              <span className="text-xs uppercase tracking-wider text-[#10B981] font-bold block">
                Valor com Desconto à Vista: {formatCurrencyBRL(totalCents)}
              </span>
              <p className="text-xs text-[#A8A29E] leading-relaxed">
                Abra o aplicativo do seu banco, escolha a opção <strong>PIX</strong> e aponte a câmera
                para o código ao lado, ou utilize o botão abaixo para copiar a chave PIX Copia e Cola.
              </p>

              {mpTransaction?.qrCode && (
                <div className="pt-1 flex flex-col sm:flex-row items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleCopyPix}
                    className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-bold text-xs sm:text-sm cursor-pointer transition shadow-lg"
                  >
                    {copiedPix ? '✓ Código PIX Copiado!' : 'Copiar Código PIX (Copia e Cola)'}
                  </button>

                  {mpTransaction.ticketUrl && (
                    <a
                      href={mpTransaction.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#C5A059] hover:underline"
                    >
                      Abrir comprovante no Mercado Pago →
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BLOCO CARTÃO DE CRÉDITO OU CHECKOUT PRO */}
      {(!isPix || !hasMpPix) && hasMpCheckout && (
        <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-5 sm:p-6 space-y-4 text-center md:text-left">
          <div>
            <span className="text-xs uppercase tracking-wider text-[#D4AF37] font-semibold block">
              Ambiente Seguro Mercado Pago
            </span>
            <p className="text-xs text-[#A8A29E] mt-1 leading-relaxed">
              Você será direcionada para o ambiente seguro do Mercado Pago para efetuar o pagamento
              de <strong>{formatCurrencyBRL(totalCents)}</strong> em até {installments}x no cartão.
            </p>
          </div>

          <a
            href={mpTransaction?.checkoutUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center px-8 py-3 rounded-xl bg-[#D4AF37] hover:bg-[#E5C453] text-[#0A0A0A] font-bold text-sm transition shadow-lg"
          >
            Pagar com Cartão no Mercado Pago →
          </a>
        </div>
      )}

      {/* FALLBACK / SUPORTE VIA WHATSAPP OFICIAL */}
      <div className="rounded-xl border border-[#262626] bg-[#0A0A0A] p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-[#C5A059] font-semibold">
            Dúvidas ou Atendimento pelo WhatsApp
          </span>
          {whatsappDeepLink && (
            <a
              href={whatsappDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[38px] inline-flex items-center justify-center px-4 py-1.5 rounded-lg bg-[#10B981] hover:bg-[#059669] text-[#0A0A0A] text-xs font-bold transition"
            >
              Falar no WhatsApp Oficial
            </a>
          )}
        </div>

        <pre className="whitespace-pre-wrap rounded border border-[#262626] bg-[#141414] p-3 text-xs text-[#F5F5F4] font-mono leading-relaxed">
          {whatsappMessage}
        </pre>
      </div>
    </section>
  );
}
