type WhatsAppCrew = {
  from: string;
  to: string;
  commander: string;
  driver: string;
  firefighters: [string, string];
  dt: string[];
  obligations?: {
    dt: { name: string; due: string | null; overdue: boolean }[];
    drivers: { name: string }[];
    monthLabel: string;
  };
};

// Emoji jsou zapsané pomocí Unicode escape sekvencí. Zdrojový soubor tak
// zůstává přenositelný i přes nástroje, které neumějí ukládat emoji v UTF-8.
const ICON = {
  engine: '\u{1F692}',
  calendar: '\u{1F4C5}',
  firefighter: '\u{1F468}\u{200D}\u{1F692}',
  lungs: '\u{1FAC1}',
  check: '\u{2705}',
};

export function buildWhatsAppMessage(crew: WhatsAppCrew) {
  const lines = [
    `${ICON.engine} JSDH NEHVIZDY – TÝDENNÍ SLUŽBA`,
    '',
    `${ICON.calendar} ${crew.from} – ${crew.to}`,
    '',
    `${ICON.firefighter} Velitel: ${crew.commander}`,
    `${ICON.engine} Strojník: ${crew.driver}`,
    `${ICON.firefighter} Hasič: ${crew.firefighters[0]}`,
    `${ICON.firefighter} Hasič: ${crew.firefighters[1]}`,
    '',
    `${ICON.lungs} DT: ${crew.dt.join(', ')}`,
    '',
    `${ICON.check} Posádka 3+1 potvrzena.`,
  ];
  if (crew.obligations) {
    lines.push('', '\u{26A0}\u{FE0F} POVINNOSTI');
    if (!crew.obligations.dt.length && !crew.obligations.drivers.length) lines.push('', `${ICON.check} Kondiční povinnosti jsou aktuálně splněny.`);
    if (crew.obligations.dt.length) {
      lines.push('', `${ICON.lungs} DT:`);
      for (const item of crew.obligations.dt) lines.push(`${item.name} – ${item.due ? item.overdue ? `PO TERMÍNU od ${formatDue(item.due)}` : `prodýchání do ${formatDue(item.due)}` : 'bez záznamu'}`);
    }
    if (crew.obligations.drivers.length) {
      lines.push('', `${ICON.engine} Kondiční jízdy – ${crew.obligations.monthLabel}:`);
      for (const item of crew.obligations.drivers) lines.push(`${item.name} – chybí`);
    }
  }
  return lines.join('\n');
}

function formatDue(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export function createWhatsAppShareUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function buildMonthlyWhatsAppMessage(monthLabel:string,services:{from:string;to:string;commander:string;driver:string;firefighters:[string,string]}[]){const lines=[`JSDH Nehvizdy – plán služeb ${monthLabel}`,''];for(const service of services){lines.push(`${service.from.slice(0,5)}–${service.to.slice(0,5)}`);lines.push(`V: ${service.commander}`);lines.push(`S: ${service.driver}`);lines.push(`H: ${service.firefighters[0]}`);lines.push(`H: ${service.firefighters[1]}`,'');}return lines.join('\n').trim();}
