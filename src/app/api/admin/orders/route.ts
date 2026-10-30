import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import {
  adminConfirmOrderPayment,
  adminUpdateOrderOperationalStatus,
  OrderStatusEnum,
  releaseExpiredOrderReservations,
} from '@/lib/orders';

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    await releaseExpiredOrderReservations();

    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: true,
        shipping: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({ orders }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao listar pedidos.';
    const status = message.includes('UNAUTHENTICATED')
      ? 401
      : message.includes('FORBIDDEN')
      ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

const AdminOrderPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confirm_manual_payment'),
    orderId: z.string().min(1),
    reason: z.string().min(5, 'Informe o motivo/protocolo da confirmação manual.'),
    externalNsuOrId: z.string().optional(),
  }),
  z.object({
    action: z.literal('update_operational_status'),
    orderId: z.string().min(1),
    orderStatus: OrderStatusEnum,
    trackingCode: z.string().optional().nullable(),
    internalAdminNotes: z.string().optional().nullable(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const body = await request.json();
    const parsed = AdminOrderPatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Dados inválidos.' },
        { status: 400 }
      );
    }

    if (parsed.data.action === 'confirm_manual_payment') {
      const updated = await adminConfirmOrderPayment({
        orderId: parsed.data.orderId,
        adminUserId: session.userId,
        reason: parsed.data.reason,
        externalNsuOrId: parsed.data.externalNsuOrId,
      });
      return NextResponse.json({ order: updated }, { status: 200 });
    }

    const updated = await adminUpdateOrderOperationalStatus({
      orderId: parsed.data.orderId,
      adminUserId: session.userId,
      orderStatus: parsed.data.orderStatus,
      trackingCode: parsed.data.trackingCode,
      internalAdminNotes: parsed.data.internalAdminNotes,
    });

    return NextResponse.json({ order: updated }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar pedido.';
    const status = message.includes('UNAUTHENTICATED')
      ? 401
      : message.includes('FORBIDDEN')
      ? 403
      : message.includes('ESTOQUE_INSUFICIENTE')
      ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
