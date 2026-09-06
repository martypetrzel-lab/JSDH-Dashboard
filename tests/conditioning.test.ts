import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths, conditioningAttention, driverDuty, dtDuty, type ConditioningData, type ConditioningMember, type DriverActivityRow, type DtActivityRow } from '../lib/conditioning.ts';

const dtMember:ConditioningMember={id:'dt',name:'Nositel DT',dt:true,canDrive:false};
const driver:ConditioningMember={id:'driver',name:'Strojník',dt:false,canDrive:true};
const dtActivity=(date:string,type:'CONDITIONING'|'INCIDENT'='CONDITIONING'):DtActivityRow=>({id:`dt-${date}-${type}`,memberId:'dt',date,type,cylinderNumber:'',carrierNumber:'',maskNumber:'',incidentReference:'',note:''});
const drive=(date:string,type:'CONDITIONING'|'INCIDENT'='CONDITIONING'):DriverActivityRow=>({id:`drive-${date}-${type}`,memberId:'driver',date,type,vehicle:'CAS',kilometers:null,incidentReference:'',note:''});

void test('kondiční DT vytvoří termín přesně za tři kalendářní měsíce',()=>assert.equal(dtDuty(dtMember,[dtActivity('2026-08-30')],new Date('2026-09-01T10:00:00Z'))?.due,'2026-11-30'));
void test('neexistující cílový den se uzavře na konec měsíce',()=>assert.equal(addCalendarMonths(new Date('2026-11-30T12:00:00Z'),3).toISOString().slice(0,10),'2027-02-28'));
void test('použití DT při zásahu resetuje tříměsíční interval',()=>assert.equal(dtDuty(dtMember,[dtActivity('2026-08-30'),dtActivity('2026-10-12','INCIDENT')],new Date('2026-10-13T10:00:00Z'))?.due,'2027-01-12'));
void test('bere se vždy nejnovější DT událost',()=>assert.equal(dtDuty(dtMember,[dtActivity('2026-05-01'),dtActivity('2026-08-20')],new Date('2026-09-01T10:00:00Z'))?.last?.date,'2026-08-20'));
void test('člen bez DT se neupozorňuje',()=>assert.equal(dtDuty({...dtMember,dt:false},[],new Date()),null));
void test('DT stav je žlutý do 30 dní a červený po termínu',()=>{assert.equal(dtDuty(dtMember,[dtActivity('2026-06-30')],new Date('2026-09-01T10:00:00Z'))?.status,'warning');assert.equal(dtDuty(dtMember,[dtActivity('2026-05-01')],new Date('2026-09-01T10:00:00Z'))?.status,'expired');});
void test('nositel DT bez historie vyžaduje pozornost',()=>assert.equal(dtDuty(dtMember,[],new Date())?.status,'missing'));
void test('kondiční jízda i jízda k zásahu splní aktuální měsíc',()=>{const now=new Date('2026-09-15T10:00:00Z');assert.equal(driverDuty(driver,[drive('2026-09-01')],now)?.fulfilled,true);assert.equal(driverDuty(driver,[drive('2026-09-14','INCIDENT')],now)?.fulfilled,true);});
void test('jízda z minulého měsíce aktuální měsíc nesplní',()=>assert.equal(driverDuty(driver,[drive('2026-08-31')],new Date('2026-09-15T10:00:00Z'))?.fulfilled,false));
void test('člen bez oprávnění strojníka se neupozorňuje',()=>assert.equal(driverDuty({...driver,canDrive:false},[],new Date()),null));
void test('člen s více oprávněními se započítá podle canDrive a dt',()=>{const both={...driver,id:'both',dt:true};const data:ConditioningData={members:[both],dtActivities:[],driverActivities:[],warningDays:30};const attention=conditioningAttention(data,new Date('2026-09-15T10:00:00Z'));assert.equal(attention.dt.length,1);assert.equal(attention.drivers.length,1);});
void test('měsíční vyhodnocení používá Europe/Prague na hranici měsíce',()=>assert.equal(driverDuty(driver,[drive('2026-10-01')],new Date('2026-09-30T22:30:00Z'))?.fulfilled,true));
