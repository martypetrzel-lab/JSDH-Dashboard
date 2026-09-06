type WhatsAppCrew = {
  from: string;
  to: string;
  commander: string;
  driver: string;
  firefighters: [string, string];
  dt: string[];
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
  return [
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
  ].join('\n');
}

export function createWhatsAppShareUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
