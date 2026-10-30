import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { recordAuditLog } from '@/lib/audit';

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const [settings, purchaseLists] = await Promise.all([
      prisma.storeSettings.findUnique({ where: { id: 'default' } }),
      prisma.supplierPurchaseList.findMany({
        include: {
          items: {
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return NextResponse.json({
      settings: settings || {
        defaultMarkupPercent: 120.0,
        pixDiscountPercent: 10.0,
        gatewayPixFeePercent: 0.99,
        gatewayCardFeePercent: 3.99,
      },
      purchaseLists,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acesso negado.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();

    // 1. Atualização de configurações estratégicas (Markup %, Desconto PIX % e Taxas Mercado Pago)
    if (body.action === 'UPDATE_SETTINGS') {
      const defaultMarkupPercent = Math.max(0, Number(body.defaultMarkupPercent ?? 120));
      const pixDiscountPercent = Math.max(0, Math.min(80, Number(body.pixDiscountPercent ?? 10)));
      const gatewayPixFeePercent = Math.max(0, Math.min(50, Number(body.gatewayPixFeePercent ?? 0.99)));
      const gatewayCardFeePercent = Math.max(0, Math.min(50, Number(body.gatewayCardFeePercent ?? 3.99)));

      const updatedSettings = await prisma.storeSettings.upsert({
        where: { id: 'default' },
        update: {
          defaultMarkupPercent,
          pixDiscountPercent,
          gatewayPixFeePercent,
          gatewayCardFeePercent,
        },
        create: {
          id: 'default',
          storeName: 'STILLUS ALBAN',
          defaultMarkupPercent,
          pixDiscountPercent,
          gatewayPixFeePercent,
          gatewayCardFeePercent,
          whatsappNumber: process.env.STORE_WHATSAPP_NUMBER || '5527996929005',
        },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'STORE_MARKUP_SETTINGS_UPDATED',
        entityType: 'StoreSettings',
        entityId: 'default',
        after: updatedSettings,
      });

      return NextResponse.json({ settings: updatedSettings });
    }

    // 2. Adicionar item de produto/variação a uma Lista de Pedido ao Fornecedor
    if (body.action === 'ADD_ITEM') {
      const {
        purchaseListId,
        productId,
        variantId,
        productName,
        skuCode,
        colorName,
        sizeLabel,
        quantity,
        unitCostCents,
        unitSalePriceCents,
      } = body;

      if (!purchaseListId || !productName || !skuCode) {
        return NextResponse.json(
          { error: 'Lista de pedido, produto e SKU são obrigatórios.' },
          { status: 400 }
        );
      }

      const qty = Math.max(1, Number(quantity || 1));
      const cost = Math.max(0, Math.round(Number(unitCostCents || 0)));
      const sale = Math.max(0, Math.round(Number(unitSalePriceCents || 0)));

      const existingItem = await prisma.supplierPurchaseItem.findFirst({
        where: {
          purchaseListId,
          skuCode,
        },
      });

      let item;
      if (existingItem) {
        item = await prisma.supplierPurchaseItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: existingItem.quantity + qty,
            unitCostCents: cost > 0 ? cost : existingItem.unitCostCents,
            unitSalePriceCents: sale > 0 ? sale : existingItem.unitSalePriceCents,
          },
        });
      } else {
        item = await prisma.supplierPurchaseItem.create({
          data: {
            purchaseListId,
            productId: productId || null,
            variantId: variantId || null,
            productName: String(productName).trim(),
            skuCode: String(skuCode).trim(),
            colorName: String(colorName || 'Padrão').trim(),
            sizeLabel: String(sizeLabel || 'Único').trim(),
            quantity: qty,
            unitCostCents: cost,
            unitSalePriceCents: sale,
          },
        });
      }

      return NextResponse.json({ item }, { status: 201 });
    }

    // 3. Criar nova Lista de Pedido ao Fornecedor com Regra de Quantidade Mínima
    const title = String(body.title || '').trim();
    if (title.length < 3) {
      return NextResponse.json(
        { error: 'Informe um título para a Lista de Pedido (mín. 3 caracteres).' },
        { status: 400 }
      );
    }

    const minOrderQuantity = Math.max(1, Math.round(Number(body.minOrderQuantity || 10)));
    const supplierName = body.supplierName ? String(body.supplierName).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    const list = await prisma.supplierPurchaseList.create({
      data: {
        title,
        supplierName,
        minOrderQuantity,
        notes,
        status: 'DRAFT',
      },
      include: { items: true },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'PURCHASE_LIST_CREATED',
      entityType: 'SupplierPurchaseList',
      entityId: list.id,
      after: list,
    });

    return NextResponse.json({ purchaseList: list }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar lista de pedidos.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();

    // Atualizar quantidade ou custo de um item específico da lista
    if (body.itemId) {
      const updatedItem = await prisma.supplierPurchaseItem.update({
        where: { id: String(body.itemId) },
        data: {
          ...(typeof body.quantity === 'number' && body.quantity >= 1
            ? { quantity: Math.round(body.quantity) }
            : {}),
          ...(typeof body.unitCostCents === 'number' && body.unitCostCents >= 0
            ? { unitCostCents: Math.round(body.unitCostCents) }
            : {}),
          ...(typeof body.unitSalePriceCents === 'number' && body.unitSalePriceCents >= 0
            ? { unitSalePriceCents: Math.round(body.unitSalePriceCents) }
            : {}),
        },
      });
      return NextResponse.json({ item: updatedItem });
    }

    // Atualizar cabeçalho/regra da lista
    const { id, title, supplierName, minOrderQuantity, status, notes } = body;
    if (!id) {
      return NextResponse.json({ error: 'ID da lista é obrigatório.' }, { status: 400 });
    }

    const updatedList = await prisma.supplierPurchaseList.update({
      where: { id: String(id) },
      data: {
        ...(typeof title === 'string' && title.trim().length >= 3 ? { title: title.trim() } : {}),
        ...(supplierName !== undefined ? { supplierName } : {}),
        ...(typeof minOrderQuantity === 'number' && minOrderQuantity >= 1
          ? { minOrderQuantity: Math.round(minOrderQuantity) }
          : {}),
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      include: { items: true },
    });

    return NextResponse.json({ purchaseList: updatedList });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar lista de pedido.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireServerAdminRole(['ADMIN_OWNER']);
    const listId = req.nextUrl.searchParams.get('id');
    const itemId = req.nextUrl.searchParams.get('itemId');

    if (itemId) {
      await prisma.supplierPurchaseItem.delete({ where: { id: itemId } });
      return NextResponse.json({ deletedItem: true });
    }

    if (listId) {
      await prisma.supplierPurchaseList.delete({ where: { id: listId } });
      return NextResponse.json({ deletedList: true });
    }

    return NextResponse.json({ error: 'Informe id ou itemId para exclusão.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao excluir registro.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
