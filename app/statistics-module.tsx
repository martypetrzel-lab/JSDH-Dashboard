'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';

type Role='COMMANDER'|'DRIVER'|'FIREFIGHTER';
type Detail={serviceId:string;from:string;to:string;role:Role};
type StatisticsRow={id:string;name:string;active:boolean;dt:boolean;served:number;servedRoles:Record<Role,number>;planned:number;plannedRoles:Record<Role,number>;total:number;lastServedAt:string|null;nextPlannedAt:string|null;replacementCount:number;replacementHours:number;differenceFromAverage:number;servedDetail:Detail[];plannedDetail:Detail[];replacementDetail:Detail[]};
type StatisticsData={rows:StatisticsRow[];summary:{servedServices:number;plannedServices:number;activeMembers:number;largestDifference:number;minimumServices:number;maximumServices:number}};
const months=['Celý rok','Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const roleLabel:Record<Role,string>={COMMANDER:'Velitel',DRIVER:'Strojník',FIREFIGHTER:'Hasič'};
const date=(value:string|null,withTime=false)=>value?new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'2-digit',month:'2-digit',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value)):'—';
const differenceLabel=(value:number)=>Math.abs(value)<.5?'Kolem průměru':value>0?`${value>=0?'+':''}${value.toFixed(1)} nad průměrem`:`${value.toFixed(1)} pod průměrem`;

export function StatisticsModule(){
  const now=new Date(),[year,setYear]=useState(now.getFullYear()),[month,setMonth]=useState(0),[memberState,setMemberState]=useState<'ALL'|'ACTIVE'|'INACTIVE'>('ALL'),[position,setPosition]=useState<'ALL'|Role>('ALL'),[sort,setSort]=useState('name'),[view,setView]=useState<'OVERVIEW'|'FAIRNESS'>('OVERVIEW'),[data,setData]=useState<StatisticsData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();fetch(`/api/statistics?year=${year}&month=${month}`,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error);setError(null);setData(body)}).catch(reason=>{if(reason.name!=='AbortError')setError(reason instanceof Error?reason.message:'Statistiky se nepodařilo načíst.')}).finally(()=>setLoading(false));return()=>controller.abort()},[year,month]);
  const rows=useMemo(()=>{
    const filtered=(data?.rows??[]).filter(row=>(memberState==='ALL'||(memberState==='ACTIVE')===row.active)&&(position==='ALL'||row.servedRoles[position]+row.plannedRoles[position]>0));
    return [...filtered].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'cs'):sort==='served'?b.served-a.served:sort==='planned'?b.planned-a.planned:sort==='commander'?(b.servedRoles.COMMANDER+b.plannedRoles.COMMANDER)-(a.servedRoles.COMMANDER+a.plannedRoles.COMMANDER):sort==='driver'?(b.servedRoles.DRIVER+b.plannedRoles.DRIVER)-(a.servedRoles.DRIVER+a.plannedRoles.DRIVER):sort==='firefighter'?(b.servedRoles.FIREFIGHTER+b.plannedRoles.FIREFIGHTER)-(a.servedRoles.FIREFIGHTER+a.plannedRoles.FIREFIGHTER):sort==='replacements'?b.replacementCount-a.replacementCount:(b.lastServedAt?new Date(b.lastServedAt).getTime():0)-(a.lastServedAt?new Date(a.lastServedAt).getTime():0));
  },[data,memberState,position,sort]);
  const years=Array.from({length:7},(_,index)=>now.getFullYear()-4+index);
  return <div className="module-stack statistics-module">
    <div className="module-title"><div><span className="section-kicker">Skutečné služby a budoucí plán</span><h2>Statistiky</h2></div><div className="view-switch"><button className={view==='OVERVIEW'?'active':''} onClick={()=>setView('OVERVIEW')}>Přehled</button><button className={view==='FAIRNESS'?'active':''} onClick={()=>setView('FAIRNESS')}>Spravedlnost</button></div></div>
    <div className="statistics-summary">
      <article><span>Odsloužených služeb</span><strong>{data?.summary.servedServices??'—'}</strong></article>
      <article><span>Naplánovaných služeb</span><strong>{data?.summary.plannedServices??'—'}</strong></article>
      <article><span>Počet aktivních členů</span><strong>{data?.summary.activeMembers??'—'}</strong></article>
      <article><span>Největší rozdíl</span><strong>{data?.summary.largestDifference??'—'}</strong><small>{data?`${data.summary.minimumServices}–${data.summary.maximumServices} služeb`:''}</small></article>
    </div>
    <article className="panel table-panel statistics-panel">
      <div className="filter-row statistics-filters">
        <select aria-label="Rok" value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value} value={value}>Rok {value}</option>)}</select>
        <select aria-label="Období" value={month} onChange={event=>setMonth(Number(event.target.value))}>{months.map((label,index)=><option key={label} value={index}>{label}</option>)}</select>
        <select aria-label="Členové" value={memberState} onChange={event=>setMemberState(event.target.value as typeof memberState)}><option value="ALL">Všichni členové</option><option value="ACTIVE">Aktivní</option><option value="INACTIVE">Neaktivní</option></select>
        <select aria-label="Pozice" value={position} onChange={event=>setPosition(event.target.value as typeof position)}><option value="ALL">Všechny pozice</option><option value="COMMANDER">Velitel</option><option value="DRIVER">Strojník</option><option value="FIREFIGHTER">Hasič</option></select>
        <select aria-label="Řazení" value={sort} onChange={event=>setSort(event.target.value)}><option value="name">Řadit podle jména</option><option value="served">Odslouženo celkem</option><option value="planned">Naplánováno celkem</option><option value="commander">Velitel</option><option value="driver">Strojník</option><option value="firefighter">Hasič</option><option value="replacements">Záskoky</option><option value="last">Poslední služba</option></select>
      </div>
      {error?<div className="report-empty">{error}</div>:loading?<div className="report-empty">Načítám statistiky…</div>:<>
        <div className="responsive-table statistics-table"><table><thead><tr>{(view==='OVERVIEW'?['Člen','Odslouženo','O · Velitel','O · Strojník','O · Hasič','Naplánováno','P · Velitel','P · Strojník','P · Hasič','Celkem','Záskoky','Poslední','Nejbližší','DT']:['Člen','Odslouženo','Naplánováno','Celkem','Rozdíl od průměru','Poslední služba','Nejbližší služba']).map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><StatisticsTableRow key={row.id} row={row} view={view} expanded={expanded===row.id} onToggle={()=>setExpanded(value=>value===row.id?null:row.id)}/>)}</tbody></table></div>
        <div className="statistics-cards">{rows.map(row=><StatisticsCard key={row.id} row={row} expanded={expanded===row.id} onToggle={()=>setExpanded(value=>value===row.id?null:row.id)}/>)}</div>
        {!rows.length&&<div className="report-empty">Filtru neodpovídá žádný člen.</div>}
      </>}
    </article>
  </div>;
}

function StatisticsTableRow({row,view,expanded,onToggle}:{row:StatisticsRow;view:'OVERVIEW'|'FAIRNESS';expanded:boolean;onToggle:()=>void}){return <>{<tr><td><button className="member-link" onClick={onToggle}>{row.name}</button>{!row.active&&<Badge variant="outline">Neaktivní</Badge>}</td>{view==='OVERVIEW'?<><td>{row.served}</td><td>{row.servedRoles.COMMANDER}</td><td>{row.servedRoles.DRIVER}</td><td>{row.servedRoles.FIREFIGHTER}</td><td>{row.planned}</td><td>{row.plannedRoles.COMMANDER}</td><td>{row.plannedRoles.DRIVER}</td><td>{row.plannedRoles.FIREFIGHTER}</td><td><strong>{row.total}</strong></td><td>{row.replacementCount} · {row.replacementHours.toFixed(1)} h</td><td>{date(row.lastServedAt)}</td><td>{date(row.nextPlannedAt)}</td><td>{row.dt?'Ano':'Ne'}</td></>:<><td>{row.served}</td><td>{row.planned}</td><td><strong>{row.total}</strong></td><td><span className={`fairness-label ${Math.abs(row.differenceFromAverage)<.5?'average':row.differenceFromAverage>0?'above':'below'}`}>{differenceLabel(row.differenceFromAverage)}</span></td><td>{date(row.lastServedAt)}</td><td>{date(row.nextPlannedAt)}</td></>}</tr>}{expanded&&<tr className="statistics-detail-row"><td colSpan={view==='OVERVIEW'?14:7}><StatisticsDetail row={row}/></td></tr>}</>}
function StatisticsCard({row,expanded,onToggle}:{row:StatisticsRow;expanded:boolean;onToggle:()=>void}){return <article><button onClick={onToggle}><strong>{row.name}</strong><span>{row.active?'Aktivní':'Neaktivní'} · DT {row.dt?'ano':'ne'}</span></button><div className="statistics-card-columns"><div><b>Odslouženo: {row.served}</b><small>Velitel {row.servedRoles.COMMANDER} · Strojník {row.servedRoles.DRIVER} · Hasič {row.servedRoles.FIREFIGHTER}</small></div><div><b>Naplánováno: {row.planned}</b><small>Velitel {row.plannedRoles.COMMANDER} · Strojník {row.plannedRoles.DRIVER} · Hasič {row.plannedRoles.FIREFIGHTER}</small></div></div><p>Záskoky: {row.replacementCount} · {row.replacementHours.toFixed(1)} h</p><p>Poslední: {date(row.lastServedAt)} · Další: {date(row.nextPlannedAt)}</p><span className="fairness-label">{differenceLabel(row.differenceFromAverage)}</span>{expanded&&<StatisticsDetail row={row}/>}</article>}
function StatisticsDetail({row}:{row:StatisticsRow}){const section=(title:string,items:Detail[],replacement=false)=><div><strong>{title}</strong>{items.length?items.map(item=><span key={`${item.serviceId}-${item.from}-${item.role}`}>{date(item.from,replacement)}{replacement?`–${date(item.to,true)}`:''} · {roleLabel[item.role]}</span>):<span>Bez záznamu</span>}</div>;return <div className="statistics-detail">{section('Odslouženo',row.servedDetail)}{section('Naplánováno',row.plannedDetail)}{section('Záskoky',row.replacementDetail,true)}</div>}
