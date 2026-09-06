type WhatsAppCrew = {
  from: string;
  to: string;
  commander: string;
  driver: string;
  firefighters: [string, string];
  dt: string[];
  updated?: boolean;
  replacements?: { originalName:string; replacementName:string; from:string; to:string }[];
  temporaryCrews?: { from: string; to: string; changes: string[] }[];
  obligations?: {
    dt: { name: string; due: string | null; overdue: boolean }[];
    drivers: { name: string }[];
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
  if (crew.temporaryCrews?.length) {
    if (!crew.replacements?.length) lines.push('', `${emoji.replacement} ZÁSKOKY`);
    for (const interval of crew.temporaryCrews) lines.push('', `${interval.from}–${interval.to}`, ...interval.changes);
  }
  if (crew.obligations) {
    lines.push('', `${emoji.warning} POVINNOSTI`);
    if (!crew.obligations.dt.length && !crew.obligations.drivers.length) lines.push('', `${emoji.check} Kondiční povinnosti jsou aktuálně splněny.`);
    if (crew.obligations.dt.length) {
      lines.push('', `${emoji.lungs} DT:`);
      for (const item of crew.obligations.dt) lines.push(`${item.name} – ${item.due ? item.overdue ? `PO TERMÍNU od ${formatDue(item.due)}` : `prodýchání do ${formatDue(item.due)}` : 'bez záznamu'}`);
    }
    if (crew.obligations.drivers.length) {
      lines.push('', `${emoji.fireEngine} Kondiční jízdy – ${crew.obligations.monthLabel}:`);
      for (const item of crew.obligations.drivers) lines.push(`${item.name} – chybí`);
    }
  }
  return lines.join('\n');
}

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
