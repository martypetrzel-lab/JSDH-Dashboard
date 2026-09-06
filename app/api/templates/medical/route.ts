import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { validateMedicalTemplateFile } from '@/lib/medical-template';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  if (!(await requireAdminApi())) return new Response('Nepřihlášený přístup', { status: 401 });
  const document = await getPrisma().medicalTemplate.findUnique({ where: { id: 'current' } });
  if (!document) return new Response('Vzor dokumentu zatím nebyl nahrán.', { status: 404 });
  return new Response(Buffer.from(document.data), {
    headers: {
      'content-type': document.contentType,
      'content-length': String(document.size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
      'cache-control': 'private, no-store',
    },
  });
}

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup' }, { status: 401 });
  try {
    const data = await request.formData();
    const entry = data.get('file');
    if (!entry || typeof entry === 'string' || typeof entry.arrayBuffer !== 'function') return NextResponse.json({ error: 'Vyberte soubor k nahrání.' }, { status: 400 });
    const validationError = validateMedicalTemplateFile(entry);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const bytes = Buffer.from(await entry.arrayBuffer());
    const prisma = getPrisma();
    const document = await prisma.$transaction(async (tx) => {
      const saved = await tx.medicalTemplate.upsert({
        where: { id: 'current' },
        update: { filename: entry.name, contentType: entry.type || 'application/octet-stream', data: bytes, size: bytes.byteLength, uploadedAt: new Date() },
        create: { id: 'current', filename: entry.name, contentType: entry.type || 'application/octet-stream', data: bytes, size: bytes.byteLength },
      });
      await tx.auditLog.create({ data: { action: 'UPLOAD', entity: 'MedicalTemplate', entityId: 'current', description: 'Vzor lékařského posudku byl nahrán.', actor: 'Administrátor' } });
      return saved;
    });
    return NextResponse.json({ ok: true, filename: document.filename, size: document.size }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Soubor se nepodařilo uložit do databáze.' }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup' }, { status: 401 });
  await getPrisma().$transaction([
    getPrisma().medicalTemplate.deleteMany({ where: { id: 'current' } }),
    getPrisma().auditLog.create({ data: { action: 'DELETE', entity: 'MedicalTemplate', entityId: 'current', description: 'Vzor lékařského posudku byl odstraněn.', actor: 'Administrátor' } }),
  ]);
  return NextResponse.json({ ok: true });
}
