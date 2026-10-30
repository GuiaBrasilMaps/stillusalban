import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';

export interface AuditLogInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

export async function recordAuditLog(
  input: AuditLogInput,
  client: PrismaClient = defaultPrisma
) {
  return client.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.before !== undefined ? JSON.stringify(input.before) : null,
      afterJson: input.after !== undefined ? JSON.stringify(input.after) : null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
