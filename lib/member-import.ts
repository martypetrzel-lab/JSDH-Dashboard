export const IMPORT_ROLES = ['Velitel jednotky', 'Velitel družstva', 'Strojník', 'Hasič', 'Neurčeno'] as const;
export type ImportRole = (typeof IMPORT_ROLES)[number];

export type ParsedMemberImportRow = {
  clientId: string;
  rowNumber: number;
  name: string;
  birthDate: string;
  role: string;
  medicalExamAt: string;
  medicalValidUntil: string;
  permissions: string;
  dt: false;
  errors: string[];
};

const HEADER_NAMES = new Map<string, 'name' | 'birthDate' | 'role' | 'medicalExamAt'>([
  ['jmeno', 'name'], ['clen', 'name'], ['name', 'name'],
  ['datum narozeni', 'birthDate'], ['narozeni', 'birthDate'], ['birth date', 'birthDate'],
  ['hlavni funkce', 'role'], ['funkce', 'role'], ['role', 'role'],
  ['datum posledni zdravotni prohlidky', 'medicalExamAt'], ['posledni zdravotni prohlidka', 'medicalExamAt'],
  ['zdravotni prohlidka', 'medicalExamAt'], ['medical exam', 'medicalExamAt'],
] as const);

export function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs-CZ').trim().replace(/\s+/g, ' ');
}

export function probableDuplicateKey(name: string, birthDate: string) {
  const nameKey = normalizeText(name).split(' ').filter(Boolean).sort().join(' ');
  const compactDate = birthDate.replace(/\s/g, '');
  return `${nameKey}|${normalizeCzechDate(compactDate) ?? compactDate}`;
}

export function normalizeCzechDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

export function addTwoCalendarYears(value: string) {
  const normalized = normalizeCzechDate(value);
  if (!normalized) return '';
  const [day, month, year] = normalized.split('.').map(Number);
  const lastDay = new Date(Date.UTC(year + 2, month, 0, 12)).getUTCDate();
  return `${String(Math.min(day, lastDay)).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year + 2}`;
}

export function importRoleDetails(role: string) {
  const roles = {
    'Velitel jednotky': { primaryRole: 'UNIT_COMMANDER', canCommand: true, canDrive: false, canFight: true },
    'Velitel družstva': { primaryRole: 'SQUAD_COMMANDER', canCommand: true, canDrive: false, canFight: true },
    'Strojník': { primaryRole: 'DRIVER', canCommand: false, canDrive: true, canFight: true },
    'Hasič': { primaryRole: 'FIREFIGHTER', canCommand: false, canDrive: false, canFight: true },
    'Neurčeno': { primaryRole: 'UNASSIGNED', canCommand: false, canDrive: false, canFight: false },
  } as const;
  return roles[role as ImportRole] ?? null;
}

export function normalizeImportRecord(input: { name: string; birthDate?: string; role: string; medicalExamAt?: string }, rowNumber: number, clientId = `row-${rowNumber}`): ParsedMemberImportRow {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const birthDate = normalizeCzechDate(input.birthDate ?? '');
  const medicalExamAt = normalizeCzechDate(input.medicalExamAt ?? '');
  const special = name === 'Poplachový uživatel';
  const role = special ? 'Neurčeno' : input.role.trim().replace(/\s+/g, ' ');
  const roleDetails = importRoleDetails(role);
  const errors: string[] = [];
  if (!name) errors.push('Jméno je povinné.');
  if (birthDate === null) errors.push('Neplatné datum narození.');
  if (!roleDetails) errors.push('Neznámá hlavní funkce.');
  if (medicalExamAt === null) errors.push('Neplatné datum zdravotní prohlídky.');
  const permissions = roleDetails
    ? [roleDetails.canCommand && 'Velitel', roleDetails.canDrive && 'Strojník', roleDetails.canFight && 'Hasič'].filter(Boolean).join(' · ')
    : '—';
  return {
    clientId,
    rowNumber,
    name,
    birthDate: birthDate ?? input.birthDate?.trim() ?? '',
    role,
    medicalExamAt: medicalExamAt ?? input.medicalExamAt?.trim() ?? '',
    medicalValidUntil: medicalExamAt ? addTwoCalendarYears(medicalExamAt) : '',
    permissions: special ? '—' : permissions,
    dt: false,
    errors,
  };
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { cells.push(value.trim()); value = ''; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
}

export function parseMemberTable(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = countDelimiter(lines[0], '\t') ? '\t' : countDelimiter(lines[0], ';') >= countDelimiter(lines[0], ',') ? ';' : ',';
  const table = lines.map((line) => splitDelimitedLine(line, delimiter));
  const headerMatches = table[0].map((cell) => HEADER_NAMES.get(normalizeText(cell)));
  const hasHeader = headerMatches.filter(Boolean).length >= 2;
  const indexes = {
    name: hasHeader ? headerMatches.indexOf('name') : 0,
    birthDate: hasHeader ? headerMatches.indexOf('birthDate') : 1,
    role: hasHeader ? headerMatches.indexOf('role') : 2,
    medicalExamAt: hasHeader ? headerMatches.indexOf('medicalExamAt') : 3,
  };
  const startIndex = hasHeader ? 1 : 0;
  return table.slice(startIndex).map((cells, index) => normalizeImportRecord({
    name: indexes.name >= 0 ? cells[indexes.name] ?? '' : '',
    birthDate: indexes.birthDate >= 0 ? cells[indexes.birthDate] ?? '' : '',
    role: indexes.role >= 0 ? cells[indexes.role] ?? '' : '',
    medicalExamAt: indexes.medicalExamAt >= 0 ? cells[indexes.medicalExamAt] ?? '' : '',
  }, index + startIndex + 1));
}
