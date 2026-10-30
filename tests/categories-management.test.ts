import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma';

test('Fase 1: Módulo de Categorias — Criação, Atualização, Medidas de Frete e Integridade', async () => {
  const testSlug = `categoria-teste-${Date.now()}`;
  let createdCatId: string | null = null;

  try {
    // 1. Criação de nova categoria com medidas de frete personalizadas para o Melhor Envio
    const created = await prisma.category.create({
      data: {
        name: 'Rasteiras & Papetes',
        slug: testSlug,
        description: 'Linha leve de calçados para o dia a dia',
        displayOrder: 10,
        isActive: true,
        defaultWeightKg: 0.45,
        defaultHeightCm: 12,
        defaultWidthCm: 20,
        defaultLengthCm: 28,
      },
    });

    createdCatId = created.id;
    assert.equal(created.name, 'Rasteiras & Papetes');
    assert.equal(created.defaultWeightKg, 0.45);
    assert.equal(created.defaultHeightCm, 12);
    assert.equal(created.defaultWidthCm, 20);
    assert.equal(created.defaultLengthCm, 28);
    assert.equal(created.isActive, true);

    // 2. Atualização de dados da categoria
    const updated = await prisma.category.update({
      where: { id: created.id },
      data: {
        name: 'Rasteiras, Papetes & Slides',
        defaultWeightKg: 0.5,
        displayOrder: 5,
      },
    });

    assert.equal(updated.name, 'Rasteiras, Papetes & Slides');
    assert.equal(updated.defaultWeightKg, 0.5);
    assert.equal(updated.displayOrder, 5);

    // 3. Alternância de status (Desativar e Reativar)
    const deactivated = await prisma.category.update({
      where: { id: created.id },
      data: { isActive: false },
    });
    assert.equal(deactivated.isActive, false);

    const reactivated = await prisma.category.update({
      where: { id: created.id },
      data: { isActive: true },
    });
    assert.equal(reactivated.isActive, true);

    // 4. Listagem e contagem de produtos associados
    const list = await prisma.category.findMany({
      where: { id: created.id },
      include: {
        _count: { select: { products: true } },
      },
    });
    assert.equal(list.length, 1);
    assert.equal(list[0]._count.products, 0);
  } finally {
    if (createdCatId) {
      await prisma.category.deleteMany({ where: { id: createdCatId } });
    }
  }
});
