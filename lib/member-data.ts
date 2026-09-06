import { z } from 'zod';

export type MemberRow = [name: string, role: string, medicalValidUntil: string, permissions: string, dt: string, id: string];
export type AbsenceRow = { id: string; memberId: string; member: string; from: string; to: string; reason: string; label: string };
export type RecurringAbsenceRow={id:string;memberId:string;member:string;anchorStart:string;durationMinutes:number;intervalMinutes:number;reason:string};

export const memberInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  role: z.enum(['Velitel jednotky', 'Velitel družstva', 'Strojník', 'Hasič', 'Neurčeno']),
  medicalValidUntil: z.string().trim().max(20),
  permissions: z.array(z.enum(['Velitel', 'Strojník', 'Hasič'])),
  dt: z.boolean(),
});

export const unavailabilityInputSchema = z.object({
  memberId: z.string().min(1),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  reason: z.string().trim().max(500).optional().default(''),
}).refine((value) => new Date(value.from) < new Date(value.to), { message: 'Konec musí být později než začátek.' });

export const recurringUnavailabilityInputSchema=z.object({memberId:z.string().min(1),anchorStart:z.iso.datetime(),durationMinutes:z.number().int().min(1).max(10080),intervalMinutes:z.number().int().min(1).max(525600),reason:z.string().trim().max(500).optional().default('')}).refine(value=>value.intervalMinutes>=value.durationMinutes,{message:'Perioda musí být alespoň stejně dlouhá jako směna.'});

export function splitName(name: string) {
  const parts = name.trim().replace(/\s+/g, ' ').split(' ');
  return { firstName: parts.shift()!, lastName: parts.join(' ') || '—' };
}

export function primaryRole(role: string) {
  const values = {
    'Velitel jednotky': 'UNIT_COMMANDER',
    'Velitel družstva': 'SQUAD_COMMANDER',
    'Strojník': 'DRIVER',
    'Hasič': 'FIREFIGHTER',
    'Neurčeno': 'UNASSIGNED',
  } as const;
  return values[role as keyof typeof values] ?? 'UNASSIGNED';
}

export function roleLabels() {
  return {
    UNIT_COMMANDER: 'Velitel jednotky',
    SQUAD_COMMANDER: 'Velitel družstva',
    DRIVER: 'Strojník',
    FIREFIGHTER: 'Hasič',
    UNASSIGNED: 'Neurčeno',
  } as const;
}

export function parseCzechDate(value: string) {
  if (!value || value === 'Neuvedeno') return null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (!match) throw new Error('Datum musí být ve formátu DD.MM.RRRR.');
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Datum není platné.');
  return date;
}

export function formatCzechDate(value: Date | null) {
  if (!value) return 'Neuvedeno';
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
}

export function serializeMember(member: {
  id: string; firstName: string; lastName: string; primaryRole: string; medicalValidUntil: Date | null;
  canCommand: boolean; canDrive: boolean; canFight: boolean; dt: boolean;
}): MemberRow {
  const permissions = [member.canCommand && 'Velitel', member.canDrive && 'Strojník', member.canFight && 'Hasič'].filter(Boolean).join(' · ');
  return [`${member.firstName} ${member.lastName}`.trim(), roleLabels()[member.primaryRole as keyof ReturnType<typeof roleLabels>] ?? 'Neurčeno', formatCzechDate(member.medicalValidUntil), permissions, member.dt ? 'Ano' : 'Ne', member.id];
}
