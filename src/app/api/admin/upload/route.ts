import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireServerAdminRole } from '@/lib/admin-session';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif']);

export async function POST(req: NextRequest) {
  try {
    await requireServerAdminRole(['ADMIN_OWNER', 'OPERATOR']);

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Selecione um arquivo de imagem válido.' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'O arquivo excede o limite máximo de 10 MB.' },
        { status: 400 }
      );
    }

    const originalExt = path.extname(file.name || '').toLowerCase() || '.jpg';
    const ext = ALLOWED_EXTENSIONS.has(originalExt) ? originalExt : '.jpg';

    const safeBase = path
      .basename(file.name || 'foto-modelo', originalExt)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);

    const fileName = `${Date.now()}-${safeBase || 'stillus'}${ext}`;
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fullPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(fullPath, buffer);

    return NextResponse.json({
      url: `/uploads/${fileName}`,
      fileName,
      sizeBytes: buffer.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar arquivo.';
    const status =
      message.startsWith('NAO_AUTENTICADO') || message.startsWith('ACESSO_NEGADO') ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
