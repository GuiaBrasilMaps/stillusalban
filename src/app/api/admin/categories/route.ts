import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { recordAuditLog } from '@/lib/audit';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const UpsertCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, 'O nome da categoria deve ter pelo menos 2 caracteres.'),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  displayOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  defaultWeightKg: z.coerce.number().positive('O peso padrão deve ser maior que zero.').default(0.6),
  defaultHeightCm: z.coerce.number().int().min(1, 'A altura deve ser no mínimo 1 cm.').default(15),
  defaultWidthCm: z.coerce.number().int().min(5, 'A largura deve ser no mínimo 5 cm.').default(25),
  defaultLengthCm: z.coerce.number().int().min(5, 'O comprimento deve ser no mínimo 5 cm.').default(30),
});

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const categories = await prisma.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acesso negado.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);
    const body = await req.json();
    const parsed = UpsertCategorySchema.parse(body);

    const generatedSlug = (parsed.slug && parsed.slug.trim().length > 0)
      ? slugify(parsed.slug)
      : slugify(parsed.name);

    if (parsed.id) {
      // 1. Atualização de Categoria Existente
      const before = await prisma.category.findUnique({ where: { id: parsed.id } });
      if (!before) {
        return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 });
      }

      // Verifica duplicidade de slug
      const existingSlug = await prisma.category.findFirst({
        where: { slug: generatedSlug, NOT: { id: parsed.id } },
      });
      if (existingSlug) {
        return NextResponse.json(
          { error: `Já existe outra categoria com o identificador (slug) "${generatedSlug}".` },
          { status: 400 }
        );
      }

      const updated = await prisma.category.update({
        where: { id: parsed.id },
        data: {
          name: parsed.name.trim(),
          slug: generatedSlug,
          description: parsed.description ? parsed.description.trim() : null,
          displayOrder: parsed.displayOrder,
          isActive: parsed.isActive,
          defaultWeightKg: parsed.defaultWeightKg,
          defaultHeightCm: parsed.defaultHeightCm,
          defaultWidthCm: parsed.defaultWidthCm,
          defaultLengthCm: parsed.defaultLengthCm,
        },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'CATEGORY_UPDATED',
        entityType: 'Category',
        entityId: updated.id,
        before,
        after: updated,
      });

      return NextResponse.json({ category: updated });
    }

    // 2. Criação de Nova Categoria
    const existing = await prisma.category.findUnique({ where: { slug: generatedSlug } });
    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma categoria cadastrada com o nome ou identificador "${generatedSlug}".` },
        { status: 400 }
      );
    }

    const created = await prisma.category.create({
      data: {
        name: parsed.name.trim(),
        slug: generatedSlug,
        description: parsed.description ? parsed.description.trim() : null,
        displayOrder: parsed.displayOrder,
        isActive: parsed.isActive,
        defaultWeightKg: parsed.defaultWeightKg,
        defaultHeightCm: parsed.defaultHeightCm,
        defaultWidthCm: parsed.defaultWidthCm,
        defaultLengthCm: parsed.defaultLengthCm,
      },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'CATEGORY_CREATED',
      entityType: 'Category',
      entityId: created.id,
      after: created,
    });

    return NextResponse.json({ category: created }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message || 'Dados inválidos.' }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Erro ao salvar categoria.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('id');

    if (!categoryId) {
      return NextResponse.json({ error: 'ID da categoria não informado.' }, { status: 400 });
    }

    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: {
        _count: { select: { products: true } },
      },
    });

    if (!category) {
      return NextResponse.json({ error: 'Categoria não encontrada.' }, { status: 404 });
    }

    // Se a categoria possuir produtos vinculados, desativa em vez de deletar fisicamente
    if (category._count.products > 0) {
      const updated = await prisma.category.update({
        where: { id: categoryId },
        data: { isActive: false },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'CATEGORY_DEACTIVATED',
        entityType: 'Category',
        entityId: categoryId,
        before: category,
        after: updated,
      });

      return NextResponse.json({
        message: `A categoria possui ${category._count.products} produto(s) vinculado(s) e foi desativada da loja para preservar o histórico.`,
        category: updated,
      });
    }

    // Se não tiver produtos vinculados, realiza a exclusão física
    await prisma.category.delete({ where: { id: categoryId } });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'CATEGORY_DELETED',
      entityType: 'Category',
      entityId: categoryId,
      before: category,
    });

    return NextResponse.json({
      message: 'Categoria excluída com sucesso.',
      id: categoryId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar exclusão.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
