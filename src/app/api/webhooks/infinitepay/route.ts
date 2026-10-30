import { NextResponse } from 'next/server';
import { processInfinitePayWebhook } from '@/lib/orders';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signatureHeader =
      request.headers.get('x-infinitepay-signature') ||
      request.headers.get('x-webhook-signature');

    const result = await processInfinitePayWebhook({
      rawBody,
      signatureHeader,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao processar Webhook InfinitePay.';
    const status = message.includes('ASSINATURA_WEBHOOK_INVALIDA')
      ? 401
      : message.includes('PEDIDO_NAO_ENCONTRADO')
      ? 404
      : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
