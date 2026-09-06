import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { formatCzechDate, parseCzechDate, serializeMember, splitName } from '@/lib/member-data';
import { importRoleDetails, normalizeImportRecord, probableDuplicateKey } from '@/lib/member-import';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const rowSchema = z.object({
  clientId: z.string().min(1).max(80),
  name: z.string().max(160),
  birthDate: z.string().max(20).optional().default(''),
  role: z.string().max(80),
  medicalExamAt: z.string().max(20).optional().default(''),
  duplicateAction: z.enum(['skip', 'update', 'create']).default('skip'),
});

const requestSchema = z.object({ rows: z.array(rowSchema).min(1).max(500) });

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const input = requestSchema.parse(await request.json());
    const normalized = input.rows.map((row, index) => ({ ...normalizeImportRecord(row, index + 1, row.clientId), duplicateAction: row.duplicateAction }));
    const prisma = getPrisma();
    const result = await prisma.$transaction(async (tx) => {
      const existingMembers = await tx.member.findMany();
      const known = new Map(existingMembers.map((member) => [
        probableDuplicateKey(`${member.firstName} ${member.lastName === '—' ? '' : member.lastName}`.trim(), member.birthDate ? formatCzechDate(member.birthDate) : ''),
        member.id,
      ]));
      let imported = 0;
      let skipped = 0;
      let errors = 0;

      for (const row of normalized) {
        const role = importRoleDetails(row.role);
        if (row.errors.length || !role) { errors += 1; continue; }
        const key = probableDuplicateKey(row.name, row.birthDate);
        const duplicateId = known.get(key);
        if (duplicateId && row.duplicateAction === 'skip') { skipped += 1; continue; }

        const special = row.name === 'Poplachový uživatel';
        const data = {
          ...splitName(row.name),
          birthDate: parseCzechDate(row.birthDate),
          primaryRole: role.primaryRole,
          medicalExamAt: parseCzechDate(row.medicalExamAt),
          medicalValidUntil: parseCzechDate(row.medicalValidUntil),
          canCommand: special ? false : role.canCommand,
          canDrive: special ? false : role.canDrive,
          canFight: special ? false : role.canFight,
          dt: false,
          reserveOnly: false,
          active: !special,
          systemAccount: special,
        };

        if (duplicateId && row.duplicateAction === 'update') {
          await tx.member.update({ where: { id: duplicateId }, data });
        } else {
          const member = await tx.member.create({ data });
          if (!known.has(key)) known.set(key, member.id);
        }
        imported += 1;
      }

      await tx.auditLog.create({ data: {
        action: 'BULK_IMPORT',
        entity: 'Member',
        entityId: randomUUID(),
        description: `Hromadný import členů: zapsáno ${imported}, přeskočeno ${skipped}, chyb ${errors}.`,
        actor: 'Administrátor',
      } });
      return { imported, skipped, errors };
    });
    const members = await prisma.member.findMany({ where: { active: true, systemAccount: false }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    return NextResponse.json({ ...result, members: members.map(serializeMember) });
  } catch {
    return NextResponse.json({ error: 'Import se nepodařilo dokončit. Zkontrolujte data a zkuste to znovu.' }, { status: 400 });
  }
}
