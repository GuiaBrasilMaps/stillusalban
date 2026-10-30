import { cookies } from 'next/headers';
import { AdminRole, assertAuthorizedRole, SessionPayload, verifyAdminSession } from './auth';

export const ADMIN_COOKIE_NAME = 'stillus_admin_session';

export async function getServerAdminSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyAdminSession(token);
  } catch {
    return null;
  }
}

export async function requireServerAdminRole(
  allowedRoles: AdminRole[] = ['ADMIN_OWNER', 'OPERATOR']
): Promise<SessionPayload> {
  const session = await getServerAdminSession();
  return assertAuthorizedRole(session, allowedRoles);
}
