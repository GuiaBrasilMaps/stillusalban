import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { CreateVariantSchema, createVariantWithAudit } from '@/lib/catalog';
import { recordAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();

    // Suporte a criação em lote de múltiplas numerações de uma só vez (Estúdio Ágil)
    if (Array.isArray(body.sizes) && body.sizes.length > 0) {
      const createdVariants = [];
      const baseSkuPrefix = String(body.skuPrefix || 'SA')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
      const colorCode = String(body.colorName || 'COR')
        .trim()
        .slice(0, 3)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');

      for (const rawSize of body.sizes) {
        const sizeLabel = String(rawSize).trim();
        if (!sizeLabel) continue;
        const randomSuffix = Math.floor(10 + Math.random() * 89);
        const skuCode =
          body.sizes.length === 1 && body.skuCode
            ? String(body.skuCode).trim().toUpperCase()
            : `${baseSkuPrefix}-${colorCode}-${sizeLabel.toUpperCase()}-${randomSuffix}`;

        const parsed = CreateVariantSchema.parse({
          productId: body.productId,
          skuCode,
          colorName: body.colorName,
          colorHex: body.colorHex || null,
          modelName: body.modelName || 'Padrão',
          sizeLabel,
          priceOverrideCents: body.priceOverrideCents ?? null,
          supplyMode: body.supplyMode,
          prepDays: body.prepDays ?? null,
          initialStockOnHand: body.initialStockOnHand ?? 0,
          isActive: true,
        });

        const variant = await createVariantWithAudit(parsed, session.userId, prisma);
        createdVariants.push(variant);
      }

      return NextResponse.json({ variants: createdVariants, variant: createdVariants[0] }, { status: 201 });
    }

    const parsed = CreateVariantSchema.parse(body);

    const variant = await createVariantWithAudit(parsed, session.userId, prisma);
    return NextResponse.json({ variant }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao criar variação (SKU).';
    const status = message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();
    const { id, supplyMode, prepDays, priceOverrideCents, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID da variação é obrigatório.' }, { status: 400 });
    }

    if (supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' && (!prepDays || prepDays <= 0)) {
      return NextResponse.json(
        { error: 'Prazo de preparação confirmado exige dias úteis maior que zero.' },
        { status: 400 }
      );
    }

    const before = await prisma.productVariant.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: 'Variação (SKU) não encontrada.' }, { status: 404 });
    }

    const updated = await prisma.productVariant.update({
      where: { id },
      data: {
        ...(supplyMode ? { supplyMode } : {}),
        ...(prepDays !== undefined ? { prepDays } : {}),
        ...(priceOverrideCents !== undefined ? { priceOverrideCents } : {}),
        ...(typeof isActive === 'boolean' ? { isActive } : {}),
      },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'VARIANT_UPDATED',
      entityType: 'ProductVariant',
      entityId: updated.id,
      before,
      after: updated,
    });

    return NextResponse.json({ variant: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar variação.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID da variação é obrigatório.' }, { status: 400 });
    }

    const existing = await prisma.productVariant.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Variação não encontrada.' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.deleteMany({ where: { variantId: id } });
      await tx.productVariant.delete({ where: { id } });
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'VARIANT_DELETED',
      entityType: 'ProductVariant',
      entityId: id,
      before: existing,
    });

    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir variação.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
