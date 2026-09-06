import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { formatCzechDate } from '@/lib/member-data';
import { normalizeImportRecord, probableDuplicateKey } from '@/lib/member-import';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const rowSchema = z.object({
  clientId: z.string().min(1).max(80),
  name: z.string().max(160),
  birthDate: z.string().max(20).optional().default(''),
  role: z.string().max(80),
  medicalExamAt: z.string().max(20).optional().default(''),
});

const requestSchema = z.object({ rows: z.array(rowSchema).max(500) });

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const input = requestSchema.parse(await request.json());
    const rows = input.rows.map((row, index) => normalizeImportRecord(row, index + 1, row.clientId));
    const members = await getPrisma().member.findMany({ select: { id: true, firstName: true, lastName: true, birthDate: true } });
    const existing = new Map(members.map((member) => {
      const name = `${member.firstName} ${member.lastName === '—' ? '' : member.lastName}`.trim();
      return [
        probableDuplicateKey(name, member.birthDate ? formatCzechDate(member.birthDate) : ''),
        { memberId: member.id, name },
      ];
    }));
    const seen = new Map<string, string>();
    const duplicates: Record<string, { kind: 'database' | 'input'; memberId?: string; name: string }> = {};

    for (const row of rows) {
      if (row.errors.length || !row.name) continue;
      const key = probableDuplicateKey(row.name, row.birthDate);
      const member = existing.get(key);
      if (member) duplicates[row.clientId] = { kind: 'database', ...member };
      else if (seen.has(key)) duplicates[row.clientId] = { kind: 'input', name: seen.get(key)! };
      else seen.set(key, row.name);
    }

    return NextResponse.json({ duplicates });
  } catch {
    return NextResponse.json({ error: 'Náhled duplicit se nepodařilo ověřit.' }, { status: 400 });
  }
}
