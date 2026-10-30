import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export type AdminRole = 'ADMIN_OWNER' | 'OPERATOR';

export interface SessionPayload {
  userId: string;
  email: string;
  role: AdminRole;
}

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      'AUTH_JWT_SECRET ausente ou menor que 16 caracteres. Configure uma chave segura no ambiente.'
    );
  }
  return secret;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  if (!plainPassword || plainPassword.length < 8) {
    throw new Error('A senha administrativa deve possuir no mínimo 8 caracteres.');
  }
  return bcrypt.hash(plainPassword, 12);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string
): Promise<boolean> {
  if (!plainPassword || !passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

export function signAdminSession(payload: SessionPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

export function verifyAdminSession(token: string): SessionPayload | null {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as SessionPayload;
    if (!decoded?.userId || !decoded?.role) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function assertAuthorizedRole(
  session: SessionPayload | null,
  allowedRoles: AdminRole[]
): SessionPayload {
  if (!session) {
    throw new Error('NAO_AUTENTICADO: Sessão administrativa inválida ou ausente.');
  }
  if (!allowedRoles.includes(session.role)) {
    throw new Error(
      `ACESSO_NEGADO: O perfil ${session.role} não possui permissão para esta operação.`
    );
  }
  return session;
}
