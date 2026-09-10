import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conditioningDutySummary, type ConditioningData } from '../lib/conditioning.ts';
import { buildMonthlyWhatsAppMessage, buildWhatsAppMessage, createWhatsAppShareUrl, formatCzechDays, hasDamagedUnicode } from '../lib/whatsapp.ts';

const noDuties={dt:[],drivers:[],medical:[],monthLabel:'září 2026'};
const crew=(obligations:Parameters<typeof buildWhatsAppMessage>[0]['obligations']=noDuties)=>({from:'07.09.2026 06:00',to:'14.09.2026 06:00',commander:'Velitel',driver:'Strojník',firefighters:['Hasič A','Hasič B'] as [string,string],dt:['Velitel'],obligations});

void test('WhatsApp zpráva zachová emoji a neobsahuje náhradní otazníky', () => {
  const message = buildWhatsAppMessage({ from:'7. 9. 06:00', to:'13. 9. 06:00 2026', commander:'Bradáč Martin', driver:'Hél Milan', firefighters:['Petržel Martin','ěščřžýáíé'], dt:['Bradáč Martin'], replacements:[{originalName:'Petržel Martin',replacementName:'Hél Milan',from:'8. 9. 06:00',to:'9. 9. 06:00'}], obligations:noDuties });
  const url = createWhatsAppShareUrl(message);
  const decoded = new URL(url).searchParams.get('text');
  assert.ok(message.includes(String.fromCodePoint(0x1f692)));
  assert.ok(message.includes(String.fromCodePoint(0x1f468, 0x200d, 0x1f692)));
  assert.ok(message.includes(String.fromCodePoint(0x1fac1)));
  assert.ok(message.includes(String.fromCodePoint(0x1f4c5)));
  assert.ok(message.includes(String.fromCodePoint(0x2705)));
  assert.ok(message.includes(String.fromCodePoint(0x1f504)));
  assert.ok(message.includes(String.fromCodePoint(0x26a0, 0xfe0f)));
  assert.equal(message.includes(String.fromCodePoint(0xfffd)), false);
  assert.equal(hasDamagedUnicode(message), false);
  for(const text of ['ěščřžýáíé','Petržel','Hél','Bradáč'])assert.ok(message.includes(text));
  assert.equal(decoded, message);
  assert.ok(url.includes('%F0%9F%9A%92'));
  assert.equal(new URL(url).origin,'https://web.whatsapp.com');
});

void test('poškozený Unicode se zachytí před otevřením WhatsApp',()=>assert.equal(hasDamagedUnicode(`text ${String.fromCodePoint(0xfffd)}`),true));

void test('WhatsApp rozliší splněné, chybějící a prošlé DT z existující logiky',()=>{
  const now=new Date('2026-09-10T10:00:00Z');
  const data:ConditioningData={members:[
    {id:'dt-ok',name:'Martin Petržel',dt:true,canDrive:false,medicalValidUntil:'2027-01-01'},
    {id:'dt-missing',name:'Aleš Rykl',dt:true,canDrive:false,medicalValidUntil:'2027-01-01'},
    {id:'dt-expired',name:'Bradáč Martin',dt:true,canDrive:false,medicalValidUntil:'2027-01-01'},
    {id:'system',name:'Poplachový uživatel',dt:true,canDrive:false,medicalValidUntil:null,systemAccount:true},
  ],dtActivities:[
    {id:'a',memberId:'dt-ok',date:'2026-08-12',type:'CONDITIONING',cylinderNumber:'',carrierNumber:'',maskNumber:'',incidentReference:'',note:''},
    {id:'b',memberId:'dt-expired',date:'2026-06-09',type:'INCIDENT',cylinderNumber:'',carrierNumber:'',maskNumber:'',incidentReference:'',note:''},
  ],driverActivities:[],warningDays:30};
  const message=buildWhatsAppMessage(crew(conditioningDutySummary(data,now)));
  assert.match(message,/Splněno:[\s\S]*Martin Petržel – poslední 12\.08\.2026, další do 12\.11\.2026/);
  assert.match(message,/Aleš Rykl – bez záznamu/);
  assert.match(message,/Bradáč Martin – nesplněno, po termínu 1 den/);
  assert.doesNotMatch(message,/Poplachový uživatel/);
});

void test('WhatsApp kondiční jízdy zobrazí splnění s vozidlem, bez vozidla i chybějícího strojníka',()=>{
  const now=new Date('2026-09-10T10:00:00Z');
  const data:ConditioningData={members:[
    {id:'with',name:'Martin Petržel',dt:false,canDrive:true,medicalValidUntil:'2027-01-01'},
    {id:'without',name:'Milan Hél',dt:false,canDrive:true,medicalValidUntil:'2027-01-01'},
    {id:'missing',name:'Aleš Rykl',dt:false,canDrive:true,medicalValidUntil:'2027-01-01'},
  ],dtActivities:[],driverActivities:[
    {id:'a',memberId:'with',date:'2026-09-08',type:'CONDITIONING',vehicle:'CAS 40',kilometers:12,incidentReference:'',note:''},
    {id:'b',memberId:'without',date:'2026-09-09',type:'INCIDENT',vehicle:'',kilometers:null,incidentReference:'',note:''},
  ],warningDays:30};
  const message=buildWhatsAppMessage(crew(conditioningDutySummary(data,now)));
  assert.match(message,/Kondiční jízdy – září 2026:/);
  assert.match(message,/Martin Petržel – CAS 40, 08\.09\.2026, další do 31\.10\.2026/);
  assert.match(message,/Milan Hél – 09\.09\.2026, další do 31\.10\.2026/);
  assert.match(message,/Chybí:[\s\S]*Aleš Rykl/);
});

void test('WhatsApp zdravotní zobrazí neplatné, 60 a 1 den do konce, bez záznamu a skryje platné nad 60 dní',()=>{
  const now=new Date('2026-09-10T10:00:00Z');
  const data:ConditioningData={members:[
    {id:'expired-one',name:'Neplatný Jeden',dt:false,canDrive:false,medicalValidUntil:'2026-09-09'},
    {id:'expired-five',name:'Neplatný Více',dt:false,canDrive:false,medicalValidUntil:'2026-09-05'},
    {id:'warning-sixty',name:'Končí Šedesát',dt:false,canDrive:false,medicalValidUntil:'2026-11-09'},
    {id:'warning-one',name:'Končí Zítra',dt:false,canDrive:false,medicalValidUntil:'2026-09-11'},
    {id:'valid',name:'Platný Člen',dt:false,canDrive:false,medicalValidUntil:'2026-11-10'},
    {id:'missing',name:'Bez Prohlídky',dt:false,canDrive:false,medicalValidUntil:null},
  ],dtActivities:[],driverActivities:[],warningDays:30};
  const message=buildWhatsAppMessage(crew(conditioningDutySummary(data,now)));
  assert.match(message,/Neplatný Jeden – neplatná 1 den/);
  assert.match(message,/Neplatný Více – neplatná 5 dní/);
  assert.match(message,/Končí Šedesát – zbývá 60 dní/);
  assert.match(message,/Končí Zítra – zbývá 1 den/);
  assert.match(message,/Bez Prohlídky – bez záznamu/);
  assert.doesNotMatch(message,/Platný Člen/);
});

void test('WhatsApp oznámí samostatně splněné DT, jízdy a zdravotní prohlídky',()=>{
  const now=new Date('2026-09-10T10:00:00Z');
  const data:ConditioningData={members:[{id:'all',name:'Člen Vpořádku',dt:true,canDrive:true,medicalValidUntil:'2027-01-01'}],dtActivities:[{id:'d',memberId:'all',date:'2026-09-01',type:'CONDITIONING',cylinderNumber:'',carrierNumber:'',maskNumber:'',incidentReference:'',note:''}],driverActivities:[{id:'j',memberId:'all',date:'2026-09-02',type:'CONDITIONING',vehicle:'CAS',kilometers:null,incidentReference:'',note:''}],warningDays:30};
  const message=buildWhatsAppMessage(crew(conditioningDutySummary(data,now)));
  assert.match(message,/Všichni členové mají DT splněno/);
  assert.match(message,/Všichni strojníci mají kondiční jízdu splněnou/);
  assert.match(message,/Zdravotní prohlídky:[\s\S]*Všichni členové v pořádku/);
});

void test('české skloňování dní rozlišuje 1, 2 a 5',()=>{
  assert.equal(formatCzechDays(1),'1 den');
  assert.equal(formatCzechDays(2),'2 dny');
  assert.equal(formatCzechDays(5),'5 dní');
  assert.equal(formatCzechDays(42),'42 dní');
});

void test('měsíční WhatsApp plán je kompaktní',()=>{const message=buildMonthlyWhatsAppMessage('září 2026',[{from:'07.09.2026',to:'14.09.2026',commander:'Velitel',driver:'Strojník',firefighters:['Hasič A','Hasič B']}]);assert.match(message,/plán služeb září 2026/);assert.match(message,/07\.09–14\.09/);assert.match(message,/V: Velitel/);});
void test('aktualizovaná WhatsApp zpráva obsahuje časové záskoky',()=>{const message=buildWhatsAppMessage({updated:true,from:'07.09.2026 06:00',to:'14.09.2026 06:00',commander:'Velitel',driver:'Strojník',firefighters:['Původní hasič','Hasič B'],dt:['Velitel'],replacements:[{originalName:'Původní hasič',replacementName:'Náhradník',from:'08.09.2026 06:00',to:'09.09.2026 06:00'}]});assert.match(message,/AKTUALIZACE TÝDENNÍ SLUŽBY/);assert.ok(message.includes(`${String.fromCodePoint(0x1f504)} ZÁSKOKY`));assert.match(message,/Původní hasič:/);assert.match(message,/→ Náhradník/);});
void test('WhatsApp nezamlčí nevyřešený záskok potvrzené služby',()=>{const message=buildWhatsAppMessage({from:'14.09.2026 06:00',to:'21.09.2026 06:00',commander:'Velitel',driver:'Strojník',firefighters:['Petržel Martin','Hasič B'],dt:['Velitel'],replacements:[{originalName:'Petržel Martin',replacementName:'Náhradník zatím nebyl nalezen',from:'17.09.2026 06:00',to:'18.09.2026 06:00'}]});assert.match(message,/Petržel Martin:/);assert.match(message,/17\.09\.2026 06:00–18\.09\.2026 06:00 → Náhradník zatím nebyl nalezen/);});
void test('WhatsApp nepoužívá staré dočasné změny funkcí',()=>{const source=readFileSync('lib/whatsapp.ts','utf8');assert.doesNotMatch(source,/temporaryCrews/);});
