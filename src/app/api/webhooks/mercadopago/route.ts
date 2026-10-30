import { NextRequest, NextResponse } from 'next/server';
import { processMercadoPagoWebhookNotification } from '@/lib/orders';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryId = url.searchParams.get('data.id') || url.searchParams.get('id');
    const queryTopic = url.searchParams.get('type') || url.searchParams.get('topic');

    let bodyJson: Record<string, unknown> = {};
    let rawBody = '';
    try {
      rawBody = await req.text();
      if (rawBody) {
        bodyJson = JSON.parse(rawBody);
      }
    } catch {
      bodyJson = {};
    }

    const bodyData = (bodyJson.data as Record<string, unknown>) || {};
    const paymentId =
      queryId ||
      bodyData.id ||
      bodyJson.id ||
      (bodyJson.resource ? String(bodyJson.resource).split('/').pop() : null);

    const action = String(bodyJson.action || queryTopic || 'payment');

    if (!paymentId) {
      // Mercado Pago às vezes envia ping de teste sem id
      return NextResponse.json({ status: 'ignored', reason: 'No payment id found in webhook' });
    }

    const result = await processMercadoPagoWebhookNotification({
      paymentId: String(paymentId),
      action,
      rawPayload: rawBody || JSON.stringify({ queryId, queryTopic, bodyJson }),
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro no processamento do webhook Mercado Pago.';
    // Retorna 200 com erro logado para evitar retry storm do Mercado Pago se for inconsistência de dados do pedido
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  // Responde com 200 para testes e validações de endpoint pelo painel do Mercado Pago
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
  if (paymentId) {
    try {
      const result = await processMercadoPagoWebhookNotification({
        paymentId: String(paymentId),
        action: 'ipn_get',
      });
      return NextResponse.json({ success: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro na consulta do IPN.';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ status: 'ok', provider: 'MERCADOPAGO' });
}
