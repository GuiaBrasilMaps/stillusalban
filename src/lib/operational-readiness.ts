import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { hashPassword } from './auth';
import { getIntegrationDiagnostics, IntegrationDiagnostics } from './integrations-status';

export interface BootstrapAdminInput {
  fullName: string;
  email: string;
  passwordPlain: string;
  bootstrapToken: string;
}

/**
 * Realiza o provisionamento único (bootstrap) do primeiro administrador proprietário (ADMIN_OWNER)
 * SOMENTE quando não existir nenhum usuário cadastrado no banco (User.count === 0) e mediante
 * validação de token secreto de bootstrap. Nunca permite criar usuário com senha padrão nem
 * executar novamente após o primeiro administrador existir.
 */
export async function bootstrapFirstAdminOwner(
  input: BootstrapAdminInput,
  options?: {
    client?: PrismaClient;
    expectedTokenOverride?: string;
  }
) {
  const client = options?.client ?? defaultPrisma;
  const expectedToken = (
    options?.expectedTokenOverride ??
    process.env.ADMIN_BOOTSTRAP_TOKEN ??
    process.env.AUTH_JWT_SECRET ??
    ''
  ).trim();

  if (!expectedToken || expectedToken.length < 12) {
    throw new Error(
      'BOOTSTRAP_NAO_CONFIGURADO: Defina ADMIN_BOOTSTRAP_TOKEN no ambiente antes de provisionar o primeiro administrador.'
    );
  }

  const provided = (input.bootstrapToken || '').trim();
  if (
    provided.length !== expectedToken.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken))
  ) {
    throw new Error('TOKEN_BOOTSTRAP_INVALIDO: Chave de provisionamento inválida.');
  }

  if (!input.fullName || input.fullName.trim().length < 3) {
    throw new Error('Informe o nome completo do administrador.');
  }

  const emailClean = (input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    throw new Error('Informe um e-mail administrativo válido.');
  }

  return client.$transaction(async (tx) => {
    const existingUsersCount = await tx.user.count();
    if (existingUsersCount > 0) {
      throw new Error(
        'BOOTSTRAP_JA_REALIZADO: O primeiro administrador já foi provisionado. Utilize o painel autenticado.'
      );
    }

    const passwordHash = await hashPassword(input.passwordPlain);

    const adminUser = await tx.user.create({
      data: {
        name: input.fullName.trim(),
        email: emailClean,
        passwordHash,
        role: 'ADMIN_OWNER',
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: adminUser.id,
        action: 'FIRST_ADMIN_BOOTSTRAPPED',
        entityType: 'User',
        entityId: adminUser.id,
        afterJson: JSON.stringify({
          email: adminUser.email,
          role: adminUser.role,
        }),
      },
    });

    return {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: adminUser.role,
    };
  });
}

export interface OperationalReadinessReport {
  timestamp: string;
  databaseConnected: boolean;
  storeSettingsConfigured: boolean;
  originCep: string;
  pixDiscountPercent: number;
  maxInstallments: number;
  stockReservationMinutes: number;
  categoriesCount: number;
  activeNearbyMunicipalities: string[];
  adminUsersCount: number;
  activeProductsCount: number;
  jwtSecretConfigured: boolean;
  integrations: IntegrationDiagnostics;
}

/**
 * Avalia de forma honesta e auditável a prontidão técnica e operacional da loja STILLUS ALBAN.
 */
export async function evaluateOperationalReadiness(
  client: PrismaClient = defaultPrisma
): Promise<OperationalReadinessReport> {
  const [settings, categoriesCount, municipalities, adminUsersCount, activeProductsCount] =
    await Promise.all([
      client.storeSettings.findUnique({ where: { id: 'default' } }),
      client.category.count({ where: { isActive: true } }),
      client.nearbyMunicipality.findMany({
        where: { isActive: true, allowArrangedDelivery: true },
        orderBy: { cityName: 'asc' },
      }),
      client.user.count({ where: { isActive: true } }),
      client.product.count({ where: { status: 'ACTIVE' } }),
    ]);

  const jwtSecret = (process.env.AUTH_JWT_SECRET || '').trim();
  const integrations = getIntegrationDiagnostics({
    originCep: settings?.originCep,
    whatsappNumber: settings?.whatsappNumber,
  });

  return {
    timestamp: new Date().toISOString(),
    databaseConnected: true,
    storeSettingsConfigured: Boolean(settings),
    originCep: settings?.originCep ?? '29260-000',
    pixDiscountPercent: settings?.pixDiscountPercent ?? 10,
    maxInstallments: settings?.maxInstallments ?? 12,
    stockReservationMinutes: settings?.stockReservationMinutes ?? 30,
    categoriesCount,
    activeNearbyMunicipalities: municipalities.map((m) => m.cityName),
    adminUsersCount,
    activeProductsCount,
    jwtSecretConfigured: jwtSecret.length >= 16,
    integrations,
  };
}
