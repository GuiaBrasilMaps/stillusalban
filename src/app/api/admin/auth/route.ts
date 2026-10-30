import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  AdminRole,
  hashPassword,
  signAdminSession,
  verifyPassword,
} from '@/lib/auth';
import { ADMIN_COOKIE_NAME, getServerAdminSession } from '@/lib/admin-session';
import { recordAuditLog } from '@/lib/audit';

const BootstrapSchema = z.object({
  action: z.literal('bootstrap'),
  name: z.string().min(3, 'Nome deve possuir ao menos 3 caracteres.'),
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(8, 'A senha deve possuir no mínimo 8 caracteres.'),
});

const LoginSchema = z.object({
  action: z.literal('login'),
  email: z.string().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

export async function GET() {
  const [usersCount, session] = await Promise.all([
    prisma.user.count(),
    getServerAdminSession(),
  ]);

  const jwtSecretConfigured =
    typeof process.env.AUTH_JWT_SECRET === 'string' &&
    process.env.AUTH_JWT_SECRET.trim().length >= 16;

  return NextResponse.json({
    hasAnyAdminUser: usersCount > 0,
    jwtSecretConfigured,
    authenticated: Boolean(session),
    session,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body?.action === 'logout') {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(ADMIN_COOKIE_NAME);
      return res;
    }

    if (body?.action === 'bootstrap') {
      const parsed = BootstrapSchema.parse(body);
      const existingCount = await prisma.user.count();
      if (existingCount > 0) {
        return NextResponse.json(
          {
            error:
              'BOOTSTRAP_BLOQUEADO: Já existe administrador cadastrado. Utilize o login padrão.',
          },
          { status: 403 }
        );
      }

      const passwordHash = await hashPassword(parsed.password);
      const user = await prisma.user.create({
        data: {
          name: parsed.name.trim(),
          email: parsed.email.trim().toLowerCase(),
          passwordHash,
          role: 'ADMIN_OWNER',
          isActive: true,
          lastLoginAt: new Date(),
        },
      });

      await recordAuditLog({
        actorUserId: user.id,
        action: 'INITIAL_ADMIN_CREATED',
        entityType: 'User',
        entityId: user.id,
        after: { id: user.id, email: user.email, role: user.role },
      });

      const token = signAdminSession({
        userId: user.id,
        email: user.email,
        role: user.role as AdminRole,
      });

      const res = NextResponse.json({
        ok: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });

      res.cookies.set(ADMIN_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 8,
      });

      return res;
    }

    if (body?.action === 'login') {
      const parsed = LoginSchema.parse(body);
      const user = await prisma.user.findUnique({
        where: { email: parsed.email.trim().toLowerCase() },
      });

      if (!user || !user.isActive) {
        return NextResponse.json(
          { error: 'Credenciais inválidas ou conta inativa.' },
          { status: 401 }
        );
      }

      const valid = await verifyPassword(parsed.password, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: 'Credenciais inválidas ou conta inativa.' },
          { status: 401 }
        );
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await recordAuditLog({
        actorUserId: user.id,
        action: 'ADMIN_LOGIN_SUCCESS',
        entityType: 'User',
        entityId: user.id,
        after: { email: user.email, role: user.role },
      });

      const token = signAdminSession({
        userId: user.id,
        email: user.email,
        role: user.role as AdminRole,
      });

      const res = NextResponse.json({
        ok: true,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });

      res.cookies.set(ADMIN_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 8,
      });

      return res;
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno de autenticação.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
