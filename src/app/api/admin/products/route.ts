import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import {
  attachVariantImageWithAudit,
  CreateProductSchema,
  createProductWithAudit,
  CreateVariantSchema,
  createVariantWithAudit,
} from '@/lib/catalog';
import { recordAuditLog } from '@/lib/audit';

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const [categories, products] = await Promise.all([
      prisma.category.findMany({
        orderBy: { displayOrder: 'asc' },
      }),
      prisma.product.findMany({
        include: {
          category: true,
          variants: {
            orderBy: [{ colorName: 'asc' }, { sizeLabel: 'asc' }],
          },
          images: {
            orderBy: [{ colorName: 'asc' }, { displayOrder: 'asc' }],
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return NextResponse.json({ categories, products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acesso negado.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();

    // Suporte para Cadastro Unificado (Produto + Foto da Cor + Grade de Numerações em 1 único passo)
    // ou adição de Nova Cor + Foto + Numerações a um produto já existente (existingProductId)
    let product;
    if (body.existingProductId) {
      product = await prisma.product.findUnique({ where: { id: String(body.existingProductId) } });
      if (!product) {
        return NextResponse.json({ error: 'Produto selecionado não encontrado.' }, { status: 404 });
      }
    } else {
      const parsed = CreateProductSchema.parse(body);
      product = await createProductWithAudit(parsed, session.userId, prisma);
    }

    const createdVariants = [];
    let attachedImage = null;

    if (body.unifiedVariant && typeof body.unifiedVariant === 'object') {
      const uv = body.unifiedVariant;
      const colorName = String(uv.colorName || 'Padrão').trim();
      const colorHex =
        typeof uv.colorHex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(uv.colorHex)
          ? uv.colorHex
          : '#D4AF37';
      const modelName = String(uv.modelName || 'Padrão').trim();
      const supplyMode = uv.supplyMode || 'IN_STOCK';
      const prepDays =
        supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ? Math.max(1, Number(uv.prepDays || 5)) : null;
      const initialStockOnHand =
        supplyMode === 'IN_STOCK' ? Math.max(0, Number(uv.initialStockOnHand ?? 1)) : 0;

      const rawSizes: string[] =
        Array.isArray(uv.sizes) && uv.sizes.length > 0
          ? uv.sizes.map((s: unknown) => String(s).trim()).filter(Boolean)
          : uv.sizeLabel
          ? [String(uv.sizeLabel).trim()]
          : ['Único'];

      const basePrefix = String(uv.skuPrefix || product.slug.slice(0, 6) || 'SA')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6);
      const colorShort = colorName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3);

      for (const sizeLabel of rawSizes) {
        const suffix = Math.floor(10 + Math.random() * 89);
        const skuCode =
          rawSizes.length === 1 && uv.skuCode
            ? String(uv.skuCode).trim().toUpperCase()
            : `SA-${basePrefix}-${colorShort}-${sizeLabel.toUpperCase()}-${suffix}`;

        const parsedVariant = CreateVariantSchema.parse({
          productId: product.id,
          skuCode,
          colorName,
          colorHex,
          modelName,
          sizeLabel,
          supplyMode,
          prepDays,
          initialStockOnHand,
          isActive: true,
        });

        const variant = await createVariantWithAudit(parsedVariant, session.userId, prisma);
        createdVariants.push(variant);
      }

      if (uv.imageUrl && String(uv.imageUrl).trim().length > 0) {
        attachedImage = await attachVariantImageWithAudit(
          {
            productId: product.id,
            colorName,
            modelName,
            url: String(uv.imageUrl).trim(),
            altText:
              uv.imageAlt && String(uv.imageAlt).trim().length >= 3
                ? String(uv.imageAlt).trim()
                : `${product.name} na cor ${colorName}`,
            displayOrder: 0,
            isPrimary: true,
          },
          session.userId,
          prisma
        );
      }
    }

    return NextResponse.json(
      {
        product,
        createdVariants,
        attachedImage,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao criar produto.';
    const status = message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();
    const {
      id,
      name,
      shortDescription,
      fullDescription,
      material,
      status,
      costPriceCents,
      basePriceCents,
      promotionalPriceCents,
      isFeatured,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID do produto é obrigatório.' }, { status: 400 });
    }

    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(typeof name === 'string' && name.trim().length >= 3 ? { name: name.trim() } : {}),
        ...(typeof shortDescription === 'string' && shortDescription.trim().length >= 5
          ? { shortDescription: shortDescription.trim() }
          : {}),
        ...(fullDescription !== undefined ? { fullDescription } : {}),
        ...(material !== undefined ? { material } : {}),
        ...(status ? { status } : {}),
        ...(typeof costPriceCents === 'number' && costPriceCents >= 0 ? { costPriceCents } : {}),
        ...(typeof basePriceCents === 'number' && basePriceCents > 0 ? { basePriceCents } : {}),
        ...(promotionalPriceCents !== undefined ? { promotionalPriceCents } : {}),
        ...(typeof isFeatured === 'boolean' ? { isFeatured } : {}),
      },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: updated.id,
      before,
      after: updated,
    });

    return NextResponse.json({ product: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar produto.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID do produto é obrigatório.' }, { status: 400 });
    }

    const existing = await prisma.product.findUnique({
      where: { id },
      include: { variants: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventoryMovement.deleteMany({
        where: { variant: { productId: id } },
      });
      await tx.product.delete({ where: { id } });
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'PRODUCT_DELETED',
      entityType: 'Product',
      entityId: id,
      before: existing,
    });

    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir produto.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
