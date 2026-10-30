import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { adjustStockOnHand, ManualStockAdjustSchema } from '@/lib/inventory';

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const [variants, recentMovements] = await Promise.all([
      prisma.productVariant.findMany({
        include: {
          product: {
            select: { id: true, name: true, slug: true, status: true },
          },
        },
        orderBy: [{ product: { name: 'asc' } }, { colorName: 'asc' }, { sizeLabel: 'asc' }],
      }),
      prisma.inventoryMovement.findMany({
        include: {
          variant: {
            include: {
              product: { select: { name: true } },
            },
          },
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return NextResponse.json({ variants, recentMovements });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acesso negado.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();
    const parsed = ManualStockAdjustSchema.parse(body);

    const result = await adjustStockOnHand(parsed, session.userId, prisma);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao ajustar estoque.';
    const status = message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
