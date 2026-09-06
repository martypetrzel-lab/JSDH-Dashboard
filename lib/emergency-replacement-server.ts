import { getPrisma } from './prisma';
import { DEFAULT_SERVICE_SETTINGS, intervalsOverlap, recurringOccurrences, replacementCandidates, type Assignment, type Role } from './service';
import { toPlanningCandidates } from './service-candidates';

export async function prepareEmergencyReplacement(serviceId:string,assignmentId:string,from:Date,to:Date,ignoreReplacementId?:string){
  const prisma=getPrisma();
  const [service,settings,members,history]=await Promise.all([
    prisma.weeklyService.findUnique({where:{id:serviceId},include:{assignments:true,replacements:true}}),
    prisma.settings.findUnique({where:{id:'default'}}),
    prisma.member.findMany({include:{unavailability:true,recurringUnavailability:{where:{active:true}}}}),
    prisma.weeklyServiceAssignment.findMany({where:{service:{status:{in:['CONFIRMED','DRAFT']}}},select:{memberId:true,role:true,service:{select:{weekStart:true}}}}),
  ]);
  if(!service)throw new Error('Služba nebyla nalezena.');
  if(service.status==='CANCELLED')throw new Error('Zrušenou službu nelze upravit.');
  if(from>=to||from<service.weekStart||to>service.weekEnd)throw new Error('Interval záskoku musí ležet uvnitř týdenní služby.');
  const assignment=service.assignments.find(item=>item.id===assignmentId);
  if(!assignment)throw new Error('Pozice služby nebyla nalezena.');
  if(service.replacements.some(item=>item.id!==ignoreReplacementId&&item.assignmentId===assignmentId&&intervalsOverlap(item.from,item.to,from,to)))throw new Error('Pro tuto pozici už v zadaném čase existuje jiný záskok.');
  const candidates=toPlanningCandidates(members,history,service.weekStart).map(candidate=>({...candidate,recurringUnavailable:members.find(member=>member.id===candidate.id)?.recurringUnavailability.map(rule=>({anchorStart:rule.anchorStart,durationMinutes:rule.durationMinutes,intervalMinutes:rule.intervalMinutes}))??[]}));
  const assignments:Assignment[]=service.assignments.map(item=>({role:item.role as Role,member:candidates.find(candidate=>candidate.id===item.memberId)!,mode:item.selectionMode}));
  const index=service.assignments.findIndex(item=>item.id===assignmentId);
  const busyIds=new Set(service.replacements.filter(item=>item.id!==ignoreReplacementId&&item.replacementMemberId&&intervalsOverlap(item.from,item.to,from,to)).map(item=>item.replacementMemberId!));
  const available=candidates.filter(candidate=>!busyIds.has(candidate.id)&&!candidate.recurringUnavailable?.some(rule=>recurringOccurrences(rule,from,to).length));
  const selected=replacementCandidates(assignments,index,available,from,to,settings?.minimumDt??DEFAULT_SERVICE_SETTINGS.minimumDt)[0]??null;
  const roleName=assignment.role==='COMMANDER'?'velitel':assignment.role==='DRIVER'?'strojník':'hasič';
  return{service,assignment,selected,issue:selected?null:`Chybí náhradní ${roleName}.`};
}
