import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';
const allowedExtensions = ['.doc', '.docx', '.pdf'];
const maxSize = 10 * 1024 * 1024;

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
  const data = await request.formData();
  const file = data.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Chybí soubor' }, { status: 400 });
  const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
  if (!allowedExtensions.includes(extension)) return NextResponse.json({ error: 'Povolené formáty jsou DOC, DOCX a PDF' }, { status: 400 });
  if (file.size > maxSize) return NextResponse.json({ error: 'Soubor může mít nejvýše 10 MB' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await getPrisma().medicalTemplate.upsert({
    where: { id: 'current' },
    update: { filename: file.name, contentType: file.type || 'application/octet-stream', data: bytes, size: file.size, uploadedAt: new Date() },
    create: { id: 'current', filename: file.name, contentType: file.type || 'application/octet-stream', data: bytes, size: file.size },
  });
  await getPrisma().auditLog.create({ data: { action: 'UPLOAD', entity: 'MedicalTemplate', entityId: 'current', description: 'Vzor lékařského posudku byl nahrán.', actor: 'Administrátor' } });
  return NextResponse.json({ ok: true, filename: file.name });
}

export async function DELETE() {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup' }, { status: 401 });
  await getPrisma().medicalTemplate.deleteMany({ where: { id: 'current' } });
  await getPrisma().auditLog.create({ data: { action: 'DELETE', entity: 'MedicalTemplate', entityId: 'current', description: 'Vzor lékařského posudku byl odstraněn.', actor: 'Administrátor' } });
  return NextResponse.json({ ok: true });
}
