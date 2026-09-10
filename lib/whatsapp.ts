type WhatsAppCrew = {
  from: string;
  to: string;
  commander: string;
  driver: string;
  firefighters: [string, string];
  dt: string[];
  updated?: boolean;
  replacements?: { originalName:string; replacementName:string; from:string; to:string }[];
  obligations?: {
    dt: { name: string; status: 'ok'|'warning'|'expired'|'missing'; last: string|null; due: string|null; days: number|null }[];
    drivers: { name: string; fulfilled: boolean; date: string|null; vehicle: string|null; nextDue: string }[];
    medical: { name: string; status: 'ok'|'warning'|'expired'|'missing'; validUntil: string|null; days: number|null }[];
    monthLabel: string;
  };
};

// Znaky vznikají až za běhu. Výsledek tak nezávisí na kódování zdrojového
// souboru, editoru ani na převodu escape sekvencí během sestavení.
const emoji = {
  fireEngine: String.fromCodePoint(0x1f692),
  calendar: String.fromCodePoint(0x1f4c5),
  firefighter: String.fromCodePoint(0x1f468, 0x200d, 0x1f692),
  lungs: String.fromCodePoint(0x1fac1),
  check: String.fromCodePoint(0x2705),
  warning: String.fromCodePoint(0x26a0, 0xfe0f),
  replacement: String.fromCodePoint(0x1f504),
  alert: String.fromCodePoint(0x1f6a8),
  medical: String.fromCodePoint(0x1fa7a),
  cross: String.fromCodePoint(0x274c),
  bullet: String.fromCodePoint(0x2022),
};

export function buildWhatsAppMessage(crew: WhatsAppCrew) {
  const lines = [
    `${crew.updated?`${emoji.alert} AKTUALIZACE TÝDENNÍ SLUŽBY`:`${emoji.fireEngine} JSDH NEHVIZDY – TÝDENNÍ SLUŽBA`}`,
    '',
    `${emoji.calendar} ${crew.from} – ${crew.to}`,
    '',
    `${emoji.firefighter} Velitel: ${crew.commander}`,
    `${emoji.fireEngine} Strojník: ${crew.driver}`,
    `${emoji.firefighter} Hasič: ${crew.firefighters[0]}`,
    `${emoji.firefighter} Hasič: ${crew.firefighters[1]}`,
    '',
    `${emoji.lungs} DT: ${crew.dt.join(', ')}`,
    '',
    `${emoji.check} Posádka 3+1 potvrzena.`,
  ];
  if(crew.replacements?.length){lines.push('',`${emoji.replacement} ZÁSKOKY`);let current='';for(const item of crew.replacements){if(item.originalName!==current){lines.push('',`${item.originalName}:`);current=item.originalName}lines.push(`${item.from}–${item.to} → ${item.replacementName}`)}}
  if (crew.obligations) {
    lines.push('', `${emoji.warning} POVINNOSTI`);
    appendDtDuties(lines, crew.obligations.dt);
    appendDriverDuties(lines, crew.obligations.drivers, crew.obligations.monthLabel);
    appendMedicalDuties(lines, crew.obligations.medical);
  }
  return lines.join('\n');
}

function appendDtDuties(lines:string[],items:NonNullable<WhatsAppCrew['obligations']>['dt']) {
  lines.push('', `${emoji.lungs} DT:`);
  const fulfilled=items.filter(item=>item.status==='ok'||item.status==='warning');
  const invalid=items.filter(item=>item.status==='expired'||item.status==='missing');
  if(!invalid.length){lines.push(`${emoji.check} Všichni členové mají DT splněno.`);return}
  if(fulfilled.length){lines.push('',`${emoji.check} Splněno:`);for(const item of fulfilled)lines.push(bullet(`${item.name} – poslední ${formatDue(item.last!)}, další do ${formatDue(item.due!)}`))}
  if(invalid.length){lines.push('',`${emoji.warning} Bez platného záznamu:`);for(const item of invalid)lines.push(bullet(item.status==='missing'?`${item.name} – bez záznamu`:`${item.name} – nesplněno, po termínu ${formatCzechDays(Math.abs(item.days??0))}`))}
}

function appendDriverDuties(lines:string[],items:NonNullable<WhatsAppCrew['obligations']>['drivers'],monthLabel:string) {
  lines.push('',`${emoji.fireEngine} Kondiční jízdy – ${monthLabel}:`);
  const fulfilled=items.filter(item=>item.fulfilled),missing=items.filter(item=>!item.fulfilled);
  if(!missing.length){lines.push(`${emoji.check} Všichni strojníci mají kondiční jízdu splněnou.`);return}
  if(fulfilled.length){lines.push('',`${emoji.check} Splněno:`);for(const item of fulfilled){const vehicle=item.vehicle?`${item.vehicle}, `:'';lines.push(bullet(`${item.name} – ${vehicle}${formatDue(item.date!)}, další do ${formatDue(item.nextDue)}`))}}
  if(missing.length){lines.push('',`${emoji.warning} Chybí:`);for(const item of missing)lines.push(bullet(item.name))}
}

function appendMedicalDuties(lines:string[],items:NonNullable<WhatsAppCrew['obligations']>['medical']) {
  lines.push('',`${emoji.medical} Zdravotní prohlídky:`);
  const expired=items.filter(item=>item.status==='expired'),warning=items.filter(item=>item.status==='warning'),missing=items.filter(item=>item.status==='missing');
  if(!expired.length&&!warning.length&&!missing.length){lines.push(`${emoji.check} Všichni členové v pořádku.`);return}
  if(expired.length){lines.push('',`${emoji.cross} Neplatné:`);for(const item of expired)lines.push(bullet(`${item.name} – neplatná ${formatCzechDays(Math.abs(item.days??0))}`))}
  if(warning.length){lines.push('',`${emoji.warning} Blíží se konec platnosti:`);for(const item of warning)lines.push(bullet(`${item.name} – zbývá ${formatCzechDays(item.days??0)}`))}
  if(missing.length){lines.push('',`${emoji.cross} Bez záznamu:`);for(const item of missing)lines.push(bullet(`${item.name} – bez záznamu`))}
}

function bullet(value:string){return`${emoji.bullet} ${value}`}

export function formatCzechDays(value:number){const count=Math.abs(value),label=count===1?'den':count>=2&&count<=4?'dny':'dní';return`${count} ${label}`}

function formatDue(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

const replacementCharacter = String.fromCodePoint(0xfffd);
export const whatsappUnicodeError = 'Text zprávy obsahuje poškozené Unicode znaky.';

export function hasDamagedUnicode(message: string) {
  return message.includes(replacementCharacter);
}

export function createWhatsAppShareUrl(message: string, destination: 'desktop' | 'mobile' = 'desktop') {
  const url = new URL(destination === 'desktop' ? 'https://web.whatsapp.com/send' : 'https://wa.me/');
  url.searchParams.set('text', message);
  return url.toString();
}

function diagnoseUnicode(message: string) {
  if (process.env.NODE_ENV === 'development') {
    console.table(Array.from(message).map((char) => ({ char, codePoint: char.codePointAt(0)?.toString(16) })));
  }
}

export function shareWhatsAppMessage(message: string) {
  if (hasDamagedUnicode(message)) {
    diagnoseUnicode(message);
    return { ok: false as const, error: whatsappUnicodeError };
  }
  const mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const url = createWhatsAppShareUrl(message, mobile ? 'mobile' : 'desktop');
  const decoded = new URL(url).searchParams.get('text');
  if (decoded !== message) {
    diagnoseUnicode(message);
    return { ok: false as const, error: 'Text zprávy se při vytváření WhatsApp odkazu změnil.' };
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return { ok: true as const, url };
}

export async function copyWhatsAppMessage(message: string) {
  if (hasDamagedUnicode(message)) {
    diagnoseUnicode(message);
    return { ok: false as const, error: whatsappUnicodeError };
  }
  await navigator.clipboard.writeText(message);
  return { ok: true as const };
}

export function buildMonthlyWhatsAppMessage(monthLabel:string,services:{from:string;to:string;commander:string;driver:string;firefighters:[string,string]}[]){const lines=[`JSDH Nehvizdy – plán služeb ${monthLabel}`,''];for(const service of services){lines.push(`${service.from.slice(0,5)}–${service.to.slice(0,5)}`);lines.push(`V: ${service.commander}`);lines.push(`S: ${service.driver}`);lines.push(`H: ${service.firefighters[0]}`);lines.push(`H: ${service.firefighters[1]}`,'');}return lines.join('\n').trim();}
