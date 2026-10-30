import { NextRequest, NextResponse } from 'next/server';
import { buildServerCheckoutQuote, ServerQuoteInputSchema } from '@/lib/checkout-quote';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ServerQuoteInputSchema.parse(body);

    const quote = await buildServerCheckoutQuote(parsed);
    return NextResponse.json({ quote });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível calcular o resumo do pedido e frete.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
