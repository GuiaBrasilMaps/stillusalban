import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    if (!pathSegments || pathSegments.length === 0) {
      return new NextResponse('Arquivo não informado', { status: 400 });
    }

    // Previne path traversal atacando com '..'
    const sanitizedSegments = pathSegments.map((s) => path.basename(s));
    const filePath = path.join(process.cwd(), 'public', 'uploads', ...sanitizedSegments);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('Imagem não encontrada', { status: 404 });
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return new NextResponse('Caminho inválido', { status: 400 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar imagem';
    return new NextResponse(message, { status: 500 });
  }
}
