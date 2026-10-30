import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { AttachVariantImageSchema, attachVariantImageWithAudit } from '@/lib/catalog';
import { recordAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const body = await req.json();
    const parsed = AttachVariantImageSchema.parse(body);

    const image = await attachVariantImageWithAudit(parsed, session.userId, prisma);
    return NextResponse.json({ image }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao vincular imagem à variação.';
    const status =
      message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const body = await req.json();
    const { id, isPrimary, displayOrder } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID da imagem é obrigatório.' }, { status: 400 });
    }

    const current = await prisma.productImage.findUnique({ where: { id } });
    if (!current) {
      return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
    }

    // Se for marcada como principal, remove o isPrimary das outras imagens da mesma cor/produto
    if (isPrimary) {
      await prisma.productImage.updateMany({
        where: {
          productId: current.productId,
          colorName: current.colorName,
          id: { not: id },
        },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.productImage.update({
      where: { id },
      data: {
        isPrimary: isPrimary !== undefined ? Boolean(isPrimary) : undefined,
        displayOrder: displayOrder !== undefined ? Number(displayOrder) : undefined,
      },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'PRODUCT_IMAGE_UPDATED',
      entityType: 'ProductImage',
      entityId: id,
      before: current,
      after: updated,
    });

    return NextResponse.json({ image: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar imagem.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID da imagem é obrigatório.' }, { status: 400 });
    }

    const before = await prisma.productImage.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
    }

    await prisma.productImage.delete({ where: { id } });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'PRODUCT_IMAGE_DELETED',
      entityType: 'ProductImage',
      entityId: id,
      before,
    });

    return NextResponse.json({ ok: true, deletedId: id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao remover imagem.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
