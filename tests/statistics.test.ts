import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseServiceCategory, memberServiceStatistics, statisticsSummary, type StatisticsAssignment, type StatisticsReplacement } from '../lib/statistics.ts';

const now=new Date('2026-09-09T10:00:00Z');
const service=(id:string,weekStart:string,status:string)=>({id,weekStart:new Date(weekStart),weekEnd:new Date(new Date(weekStart).getTime()+7*86400000),status});
const members=[{id:'martin',name:'Petržel Martin',active:true,dt:true},{id:'matej',name:'Petržel Matěj',active:true,dt:false},{id:'zero',name:'Člen Bez služby',active:false,dt:false}];
const assignments:StatisticsAssignment[]=[
  {memberId:'martin',role:'COMMANDER',service:service('past-confirmed','2026-09-07T04:00:00Z','CONFIRMED')},
  {memberId:'martin',role:'DRIVER',service:service('future-confirmed','2026-09-14T04:00:00Z','CONFIRMED')},
  {memberId:'martin',role:'FIREFIGHTER',service:service('future-draft','2026-09-21T04:00:00Z','DRAFT')},
  {memberId:'matej',role:'FIREFIGHTER',service:service('past-draft','2026-08-31T04:00:00Z','DRAFT')},
  {memberId:'matej',role:'FIREFIGHTER',service:service('cancelled','2026-09-28T04:00:00Z','CANCELLED')},
];
const replacements:StatisticsReplacement[]=[{replacementMemberId:'matej',role:'DRIVER',from:new Date('2026-09-14T04:00:00Z'),to:new Date('2026-09-15T16:00:00Z'),valid:true,service:service('future-confirmed','2026-09-14T04:00:00Z','CONFIRMED')}];

test('statistiky začínají všemi nesystémovými členy včetně člena bez služby',()=>{
  const rows=memberServiceStatistics(members,assignments,replacements,now);
  const zero=rows.find(row=>row.id==='zero')!;assert.equal(rows.length,3);assert.equal(zero.served,0);assert.equal(zero.planned,0);assert.equal(zero.total,0);assert.equal(zero.replacementCount,0);assert.equal(zero.replacementHours,0);
  assert.match(readFileSync('app/api/statistics/route.ts','utf8'),/systemAccount: false/);
});
test('CONFIRMED minulost je odsloužená a DRAFT minulost se nepočítá',()=>{const rows=memberServiceStatistics(members,assignments,replacements,now);assert.equal(rows.find(row=>row.id==='martin')?.served,1);assert.equal(rows.find(row=>row.id==='matej')?.served,0)});
test('budoucí CONFIRMED i DRAFT jsou naplánované a CANCELLED se ignoruje',()=>{const rows=memberServiceStatistics(members,assignments,replacements,now);const martin=rows.find(row=>row.id==='martin')!;assert.equal(martin.planned,2);assert.equal(martin.plannedRoles.DRIVER,1);assert.equal(martin.plannedRoles.FIREFIGHTER,1);assert.equal(rows.find(row=>row.id==='matej')?.planned,0)});
test('záskok nezvyšuje base služby a počítá pouze počet a hodiny',()=>{const matej=memberServiceStatistics(members,assignments,replacements,now).find(row=>row.id==='matej')!;assert.equal(matej.total,0);assert.equal(matej.replacementCount,1);assert.equal(matej.replacementHours,36)});
test('Martin a Matěj Petržel se počítají odděleně podle memberId',()=>{const rows=memberServiceStatistics(members,assignments,replacements,now);assert.equal(rows.find(row=>row.id==='martin')?.total,3);assert.equal(rows.find(row=>row.id==='matej')?.total,0)});
test('souhrn počítá unikátní služby a aktivní členy',()=>{const rows=memberServiceStatistics(members,assignments,replacements,now),summary=statisticsSummary(rows,assignments,now);assert.deepEqual(summary,{servedServices:1,plannedServices:2,activeMembers:2,largestDifference:3,minimumServices:0,maximumServices:3})});
test('statistiky a fairness sdílejí stavovou pravdu služeb',()=>{assert.equal(baseServiceCategory('CONFIRMED',new Date('2026-09-07T04:00:00Z'),now),'SERVED');assert.equal(baseServiceCategory('DRAFT',new Date('2026-09-07T04:00:00Z'),now),null);assert.equal(baseServiceCategory('DRAFT',new Date('2026-09-14T04:00:00Z'),now),'PLANNED');assert.equal(baseServiceCategory('CANCELLED',new Date('2026-09-14T04:00:00Z'),now),null);assert.match(readFileSync('lib/service-candidates.ts','utf8'),/baseServiceCategory/)});
