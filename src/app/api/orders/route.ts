import { NextResponse } from 'next/server';
import {
  CreateOrderSchema,
  createOrderWithIntegrity,
  releaseExpiredOrderReservations,
} from '@/lib/orders';

export async function POST(request: Request) {
  try {
    // Libera reservas expiradas (>30 min sem pagamento confirmado) antes de processar novo pedido
    await releaseExpiredOrderReservations();

    const body = await request.json();
    const parsed = CreateOrderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Dados inválidos para criação do pedido.' },
        { status: 400 }
      );
    }

    const result = await createOrderWithIntegrity(parsed.data);

    return NextResponse.json(
      {
        order: result.order,
        idempotentReplay: result.idempotentReplay,
      },
      { status: result.idempotentReplay ? 200 : 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar pedido.';
    const isClientRuleError =
      message.includes('ESTOQUE_INSUFICIENTE') ||
      message.includes('CIENCIA_ENCOMENDA_OBRIGATORIA') ||
      message.includes('FRETE_NAO_SELECIONADO') ||
      message.includes('VARIACAO_INDISPONIVEL');

    return NextResponse.json(
      { error: message },
      { status: isClientRuleError ? 409 : 500 }
    );
  }
}
