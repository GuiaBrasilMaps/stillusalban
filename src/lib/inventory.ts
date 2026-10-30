import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma as defaultPrisma } from './prisma';

export const ManualStockAdjustSchema = z.object({
  variantId: z.string().min(1, 'Variação (SKU) é obrigatória.'),
  quantityDelta: z
    .number()
    .int()
    .refine((val) => val !== 0, 'O ajuste de quantidade deve ser diferente de zero.'),
  movementType: z
    .enum(['INITIAL_LOAD', 'MANUAL_ADJUSTMENT', 'RETURN_RESTOCK'])
    .default('MANUAL_ADJUSTMENT'),
  reason: z.string().min(3, 'Informe o motivo do ajuste de estoque para auditoria.'),
});

/**
 * Ajuste manual, carga inicial ou devolução de estoque próprio com proteção contra
 * saldo negativo ou saldo físico inferior ao reservado.
 */
export async function adjustStockOnHand(
  rawInput: z.infer<typeof ManualStockAdjustSchema>,
  actorUserId: string | null,
  client: PrismaClient = defaultPrisma
) {
  const input = ManualStockAdjustSchema.parse(rawInput);

  return client.$transaction(async (tx) => {
    const current = await tx.productVariant.findUnique({
      where: { id: input.variantId },
    });

    if (!current) {
      throw new Error('SKU_NAO_ENCONTRADA: A variação informada não existe.');
    }

    if (current.supplyMode !== 'IN_STOCK') {
      throw new Error(
        'OPERACAO_INVALIDA: Ajuste de estoque físico só é permitido para SKUs na modalidade Estoque Próprio (IN_STOCK).'
      );
    }

    const targetOnHand = current.stockOnHand + input.quantityDelta;
    if (targetOnHand < 0) {
      throw new Error(
        `ESTOQUE_NEGATIVO_BLOQUEADO: O saldo resultante (${targetOnHand}) não pode ser negativo.`
      );
    }
    if (targetOnHand < current.stockReserved) {
      throw new Error(
        `CONFLITO_RESERVA_ESTOQUE: O saldo físico (${targetOnHand}) não pode ser menor que a quantidade atualmente reservada (${current.stockReserved}).`
      );
    }

    // Atualização condicional atômica verificando o saldo anterior exato
    const updatedCount = await tx.productVariant.updateMany({
      where: {
        id: current.id,
        stockOnHand: current.stockOnHand,
        stockReserved: current.stockReserved,
      },
      data: {
        stockOnHand: targetOnHand,
      },
    });

    if (updatedCount.count !== 1) {
      throw new Error(
        'CONCORRENCIA_ESTOQUE: O saldo foi modificado simultaneamente por outra operação. Tente novamente.'
      );
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        variantId: current.id,
        userId: actorUserId,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        previousOnHand: current.stockOnHand,
        newOnHand: targetOnHand,
        previousReserved: current.stockReserved,
        newReserved: current.stockReserved,
        reason: input.reason.trim(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'INVENTORY_ADJUSTED',
        entityType: 'ProductVariant',
        entityId: current.id,
        beforeJson: JSON.stringify({
          skuCode: current.skuCode,
          stockOnHand: current.stockOnHand,
          stockReserved: current.stockReserved,
        }),
        afterJson: JSON.stringify({
          skuCode: current.skuCode,
          stockOnHand: targetOnHand,
          stockReserved: current.stockReserved,
          reason: input.reason.trim(),
        }),
      },
    });

    const updatedVariant = await tx.productVariant.findUniqueOrThrow({
      where: { id: current.id },
    });

    return { variant: updatedVariant, movement };
  });
}

/**
 * Reserva atômica de estoque para pedidos em checkout (evita overselling em compras concorrentes).
 * Em SQLite/PostgreSQL, executa instrução condicional atômica no banco:
 * UPDATE ProductVariant SET stockReserved = stockReserved + qty
 * WHERE id = :id AND isActive = 1 AND supplyMode = 'IN_STOCK' AND (stockOnHand - stockReserved) >= qty
 */
export async function reserveVariantStock(
  params: {
    variantId: string;
    quantity: number;
    orderId?: string | null;
    reason?: string;
  },
  client: PrismaClient = defaultPrisma
) {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('QUANTIDADE_INVALIDA: A quantidade a reservar deve ser um inteiro positivo.');
  }

  return client.$transaction(async (tx) => {
    const before = await tx.productVariant.findUnique({
      where: { id: params.variantId },
    });

    if (!before || !before.isActive) {
      throw new Error('SKU_INDISPONIVEL: Variação inexistente ou inativa.');
    }

    if (before.supplyMode === 'UNAVAILABLE') {
      throw new Error(`SKU_INDISPONIVEL: A variação ${before.skuCode} está indisponível.`);
    }

    // Se a SKU for Sob Encomenda (MADE_TO_ORDER_*), não reserva estoque físico, apenas confirma elegibilidade
    if (
      before.supplyMode === 'MADE_TO_ORDER_CONFIRMED_LEAD' ||
      before.supplyMode === 'MADE_TO_ORDER_TBD_LEAD'
    ) {
      return {
        reservedPhysicalStock: false,
        variant: before,
      };
    }

    // Atualização atômica no banco para impedir estoque disponível negativo em concorrência
    const rowsAffected = await tx.$executeRaw`
      UPDATE ProductVariant
      SET stockReserved = stockReserved + ${params.quantity},
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${params.variantId}
        AND isActive = 1
        AND supplyMode = 'IN_STOCK'
        AND (stockOnHand - stockReserved) >= ${params.quantity}
    `;

    if (Number(rowsAffected) !== 1) {
      const latest = await tx.productVariant.findUnique({ where: { id: params.variantId } });
      const available = latest ? Math.max(0, latest.stockOnHand - latest.stockReserved) : 0;
      throw new Error(
        `ESTOQUE_INSUFICIENTE: A variação ${before.skuCode} possui apenas ${available} unidade(s) disponível(is).`
      );
    }

    const after = await tx.productVariant.findUniqueOrThrow({
      where: { id: params.variantId },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: after.id,
        orderId: params.orderId ?? null,
        movementType: 'ORDER_RESERVATION',
        quantityDelta: params.quantity,
        previousOnHand: before.stockOnHand,
        newOnHand: after.stockOnHand,
        previousReserved: before.stockReserved,
        newReserved: after.stockReserved,
        reason: params.reason || 'Reserva temporária de pedido aguardando pagamento',
      },
    });

    return {
      reservedPhysicalStock: true,
      variant: after,
    };
  });
}

/**
 * Libera reserva temporária (quando pagamento expira após 30 minutos ou pedido é cancelado).
 */
export async function releaseVariantReservation(
  params: {
    variantId: string;
    quantity: number;
    orderId?: string | null;
    actorUserId?: string | null;
    reason?: string;
  },
  client: PrismaClient = defaultPrisma
) {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('QUANTIDADE_INVALIDA: A quantidade a liberar deve ser positiva.');
  }

  return client.$transaction(async (tx) => {
    const before = await tx.productVariant.findUnique({
      where: { id: params.variantId },
    });

    if (!before) {
      throw new Error('SKU_NAO_ENCONTRADA: Variação não localizada.');
    }

    const rowsAffected = await tx.$executeRaw`
      UPDATE ProductVariant
      SET stockReserved = stockReserved - ${params.quantity},
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${params.variantId}
        AND stockReserved >= ${params.quantity}
    `;

    if (Number(rowsAffected) !== 1) {
      throw new Error(
        `RESERVA_INSUFICIENTE: Não há ${params.quantity} unidade(s) reservada(s) na SKU ${before.skuCode} para liberar.`
      );
    }

    const after = await tx.productVariant.findUniqueOrThrow({
      where: { id: params.variantId },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: after.id,
        orderId: params.orderId ?? null,
        userId: params.actorUserId ?? null,
        movementType: 'RESERVATION_RELEASE',
        quantityDelta: -params.quantity,
        previousOnHand: before.stockOnHand,
        newOnHand: after.stockOnHand,
        previousReserved: before.stockReserved,
        newReserved: after.stockReserved,
        reason: params.reason || 'Liberação de reserva por cancelamento ou expiração',
      },
    });

    return after;
  });
}

/**
 * Efetiva a saída definitiva do estoque próprio somente após confirmação real do pagamento.
 */
export async function confirmOrderStockDeduction(
  params: {
    variantId: string;
    quantity: number;
    orderId?: string | null;
    actorUserId?: string | null;
    reason?: string;
  },
  client: PrismaClient = defaultPrisma
) {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw new Error('QUANTIDADE_INVALIDA: A quantidade para baixa deve ser positiva.');
  }

  return client.$transaction(async (tx) => {
    const before = await tx.productVariant.findUnique({
      where: { id: params.variantId },
    });

    if (!before) {
      throw new Error('SKU_NAO_ENCONTRADA: Variação não localizada.');
    }

    const rowsAffected = await tx.$executeRaw`
      UPDATE ProductVariant
      SET stockOnHand = stockOnHand - ${params.quantity},
          stockReserved = stockReserved - ${params.quantity},
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${params.variantId}
        AND stockOnHand >= ${params.quantity}
        AND stockReserved >= ${params.quantity}
    `;

    if (Number(rowsAffected) !== 1) {
      throw new Error(
        `BAIXA_ESTOQUE_INVALIDA: A SKU ${before.skuCode} não possui reserva/saldo compatível para baixa definitiva.`
      );
    }

    const after = await tx.productVariant.findUniqueOrThrow({
      where: { id: params.variantId },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: after.id,
        orderId: params.orderId ?? null,
        userId: params.actorUserId ?? null,
        movementType: 'PAYMENT_CONFIRMED_DEDUCTION',
        quantityDelta: -params.quantity,
        previousOnHand: before.stockOnHand,
        newOnHand: after.stockOnHand,
        previousReserved: before.stockReserved,
        newReserved: after.stockReserved,
        reason: params.reason || 'Baixa definitiva após confirmação de pagamento',
      },
    });

    return after;
  });
}
