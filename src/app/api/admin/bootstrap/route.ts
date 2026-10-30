import { NextResponse } from 'next/server';
import { bootstrapFirstAdminOwner } from '@/lib/operational-readiness';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const admin = await bootstrapFirstAdminOwner({
      fullName: String(body.fullName || ''),
      email: String(body.email || ''),
      passwordPlain: String(body.passwordPlain || ''),
      bootstrapToken: String(body.bootstrapToken || ''),
    });

    return NextResponse.json({ admin }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha no bootstrap administrativo.';
    const status = message.includes('BOOTSTRAP_JA_REALIZADO')
      ? 409
      : message.includes('TOKEN_BOOTSTRAP_INVALIDO')
      ? 401
      : 400;

    return NextResponse.json({ error: message }, { status });
  }
}
