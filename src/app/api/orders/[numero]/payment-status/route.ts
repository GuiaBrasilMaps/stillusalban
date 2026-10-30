import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchMercadoPagoPayment } from '@/lib/mercadopago';
import { processMercadoPagoWebhookNotification } from '@/lib/orders';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const { numero } = await params;
    const order = await prisma.order.findUnique({
      where: { orderNumber: numero },
      include: { payments: true },
    });

    if (!order) {
      return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 });
    }

    // Se já estiver confirmado, retorna direto
    if (order.paymentStatus === 'CONFIRMADO') {
      return NextResponse.json({
        confirmed: true,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
      });
    }

    // Se houver transação Mercado Pago com externalNsuOrId, consulta na API do MP para conciliação ativa
    const mpTx = order.payments.find((p) => p.provider === 'MERCADOPAGO' && p.externalNsuOrId);
    if (mpTx && mpTx.externalNsuOrId) {
      try {
        const mpCheck = await fetchMercadoPagoPayment(mpTx.externalNsuOrId);
        if (mpCheck.success && mpCheck.payment && mpCheck.payment.status === 'approved') {
          await processMercadoPagoWebhookNotification({
            paymentId: mpTx.externalNsuOrId,
            action: 'active_client_reconciliation',
          });
          const updated = await prisma.order.findUnique({
            where: { id: order.id },
            select: { paymentStatus: true, orderStatus: true },
          });
          return NextResponse.json({
            confirmed: updated?.paymentStatus === 'CONFIRMADO',
            paymentStatus: updated?.paymentStatus,
            orderStatus: updated?.orderStatus,
          });
        }
      } catch {
        // Ignora erro de rede temporário na conciliação ativa
      }
    }

    return NextResponse.json({
      confirmed: false,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao consultar status do pagamento.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
