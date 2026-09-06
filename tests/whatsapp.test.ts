import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyWhatsAppMessage, buildWhatsAppMessage, createWhatsAppShareUrl } from '../lib/whatsapp.ts';

void test('WhatsApp zpráva zachová emoji a neobsahuje náhradní otazníky', () => {
  const message = buildWhatsAppMessage({ from:'7. 9. 06:00', to:'13. 9. 06:00 2026', commander:'Test Velitel', driver:'Test Strojník', firefighters:['Test Hasič A','Test Hasič B'], dt:['Test Velitel'] });
  const url = createWhatsAppShareUrl(message);
  const decoded = new URL(url).searchParams.get('text');
  assert.ok(message.includes(String.fromCodePoint(0x1f692)));
  assert.ok(message.includes(String.fromCodePoint(0x1f468, 0x200d, 0x1f692)));
  assert.ok(message.includes(String.fromCodePoint(0x1fac1)));
  assert.equal(message.includes(String.fromCodePoint(0xfffd)), false);
  assert.equal(decoded, message);
  assert.ok(url.includes('%F0%9F%9A%92'));
});

void test('WhatsApp obsahuje pouze povinnosti vyžadující pozornost',()=>{
  const message=buildWhatsAppMessage({from:'od',to:'do',commander:'Velitel',driver:'Strojník',firefighters:['Hasič A','Hasič B'],dt:['Velitel'],obligations:{dt:[{name:'Člen po termínu',due:'2026-09-02',overdue:true}],drivers:[{name:'Čekající strojník'}],monthLabel:'září 2026'}});
  assert.match(message,/Člen po termínu – PO TERMÍNU od 02\.09\.2026/);
  assert.match(message,/Čekající strojník – chybí/);
  assert.doesNotMatch(message,/Splněný člen/);
});

void test('WhatsApp oznámí, že nejsou žádné povinnosti',()=>{
  const message=buildWhatsAppMessage({from:'od',to:'do',commander:'Velitel',driver:'Strojník',firefighters:['Hasič A','Hasič B'],dt:['Velitel'],obligations:{dt:[],drivers:[],monthLabel:'září 2026'}});
  assert.match(message,/Kondiční povinnosti jsou aktuálně splněny/);
});

void test('měsíční WhatsApp plán je kompaktní',()=>{const message=buildMonthlyWhatsAppMessage('září 2026',[{from:'07.09.2026',to:'14.09.2026',commander:'Velitel',driver:'Strojník',firefighters:['Hasič A','Hasič B']}]);assert.match(message,/plán služeb září 2026/);assert.match(message,/07\.09–14\.09/);assert.match(message,/V: Velitel/);});
void test('aktualizovaná WhatsApp zpráva obsahuje časové záskoky',()=>{const message=buildWhatsAppMessage({updated:true,from:'07.09.2026 06:00',to:'14.09.2026 06:00',commander:'Velitel',driver:'Strojník',firefighters:['Původní hasič','Hasič B'],dt:['Velitel'],replacements:[{originalName:'Původní hasič',replacementName:'Náhradník',from:'08.09.2026 06:00',to:'09.09.2026 06:00'}]});assert.match(message,/AKTUALIZACE TÝDENNÍ SLUŽBY/);assert.ok(message.includes(`${String.fromCodePoint(0x1f504)} ZÁSKOKY`));assert.match(message,/Původní hasič:/);assert.match(message,/→ Náhradník/);});
