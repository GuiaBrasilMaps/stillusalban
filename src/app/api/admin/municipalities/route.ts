import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireServerAdminRole } from '@/lib/admin-session';
import { UpsertMunicipalitySchema } from '@/lib/shipping';
import { recordAuditLog } from '@/lib/audit';

export async function GET() {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const [settings, municipalities] = await Promise.all([
      prisma.storeSettings.findUnique({ where: { id: 'default' } }),
      prisma.nearbyMunicipality.findMany({
        orderBy: [{ isActive: 'desc' }, { cityName: 'asc' }],
      }),
    ]);

    return NextResponse.json({ settings, municipalities });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Acesso negado.';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();
    const parsed = UpsertMunicipalitySchema.parse(body);

    if (parsed.id) {
      const before = await prisma.nearbyMunicipality.findUnique({ where: { id: parsed.id } });
      if (!before) {
        return NextResponse.json({ error: 'Município não encontrado.' }, { status: 404 });
      }

      const updated = await prisma.nearbyMunicipality.update({
        where: { id: parsed.id },
        data: {
          cityName: parsed.cityName.trim(),
          stateUf: parsed.stateUf.trim().toUpperCase(),
          cepStart: parsed.cepStart,
          cepEnd: parsed.cepEnd,
          allowArrangedDelivery: parsed.allowArrangedDelivery,
          fixedFeeCents: parsed.fixedFeeCents ?? null,
          deliveryNotes: parsed.deliveryNotes.trim(),
          isActive: parsed.isActive,
        },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'NEARBY_MUNICIPALITY_UPDATED',
        entityType: 'NearbyMunicipality',
        entityId: updated.id,
        before,
        after: updated,
      });

      return NextResponse.json({ municipality: updated });
    }

    const created = await prisma.nearbyMunicipality.create({
      data: {
        cityName: parsed.cityName.trim(),
        stateUf: parsed.stateUf.trim().toUpperCase(),
        cepStart: parsed.cepStart,
        cepEnd: parsed.cepEnd,
        allowArrangedDelivery: parsed.allowArrangedDelivery,
        fixedFeeCents: parsed.fixedFeeCents ?? null,
        deliveryNotes: parsed.deliveryNotes.trim(),
        isActive: parsed.isActive,
      },
    });

    await recordAuditLog({
      actorUserId: session.userId,
      action: 'NEARBY_MUNICIPALITY_CREATED',
      entityType: 'NearbyMunicipality',
      entityId: created.id,
      after: created,
    });

    return NextResponse.json({ municipality: created }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao salvar município próximo.';
    const status = message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireServerAdminRole(['ADMIN_OWNER']);
    const body = await req.json();

    // Permite atualizar StoreSettings (CEP origem, desconto PIX, parcelas) ou ativar/desativar município
    if (body.target === 'store_settings') {
      const before = await prisma.storeSettings.findUnique({ where: { id: 'default' } });
      const updated = await prisma.storeSettings.upsert({
        where: { id: 'default' },
        update: {
          ...(body.originCep ? { originCep: String(body.originCep).trim() } : {}),
          ...(typeof body.pixDiscountPercent === 'number'
            ? { pixDiscountPercent: body.pixDiscountPercent }
            : {}),
          ...(typeof body.maxInstallments === 'number'
            ? { maxInstallments: body.maxInstallments }
            : {}),
          ...(body.whatsappNumber !== undefined
            ? { whatsappNumber: String(body.whatsappNumber).trim() }
            : {}),
        },
        create: {
          id: 'default',
          originCep: String(body.originCep || '29260-000').trim(),
          pixDiscountPercent: Number(body.pixDiscountPercent ?? 10),
          maxInstallments: Number(body.maxInstallments ?? 12),
          whatsappNumber: String(body.whatsappNumber || '').trim(),
        },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'STORE_SETTINGS_UPDATED',
        entityType: 'StoreSettings',
        entityId: 'default',
        before,
        after: updated,
      });

      return NextResponse.json({ settings: updated });
    }

    if (body.id && typeof body.isActive === 'boolean') {
      const before = await prisma.nearbyMunicipality.findUnique({ where: { id: body.id } });
      if (!before) {
        return NextResponse.json({ error: 'Município não encontrado.' }, { status: 404 });
      }

      const updated = await prisma.nearbyMunicipality.update({
        where: { id: body.id },
        data: { isActive: body.isActive },
      });

      await recordAuditLog({
        actorUserId: session.userId,
        action: 'NEARBY_MUNICIPALITY_TOGGLED',
        entityType: 'NearbyMunicipality',
        entityId: updated.id,
        before,
        after: updated,
      });

      return NextResponse.json({ municipality: updated });
    }

    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao atualizar configuração.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
