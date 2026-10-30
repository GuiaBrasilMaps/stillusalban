import { NextResponse } from 'next/server';
import { evaluateOperationalReadiness } from '@/lib/operational-readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = await evaluateOperationalReadiness();
    return NextResponse.json(
      {
        status: 'ok',
        report,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha na verificação de saúde.';
    return NextResponse.json({ status: 'error', error: message }, { status: 500 });
  }
}
