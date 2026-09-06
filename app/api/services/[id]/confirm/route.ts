import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { DEFAULT_SERVICE_SETTINGS, eligibility, validateCrew, type Assignment, type Candidate, type Role } from '@/lib/service';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime='nodejs';

export async function POST(_request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,prisma=getPrisma();
    const [service,settings]=await Promise.all([
      prisma.weeklyService.findUnique({where:{id},include:{assignments:{include:{member:{include:{unavailability:true}}},orderBy:[{role:'asc'},{slot:'asc'}]}}}),
      prisma.settings.findUnique({where:{id:'default'}}),
    ]);
    if(!service)return NextResponse.json({error:'Služba nebyla nalezena.'},{status:404});
    const minimumDt=settings?.minimumDt??DEFAULT_SERVICE_SETTINGS.minimumDt;
    const assignments:Assignment[]=service.assignments.map(item=>{const member=item.member;const candidate:Candidate={id:member.id,name:`${member.firstName} ${member.lastName==='—'?'':member.lastName}`.trim(),active:member.active,system:member.systemAccount,reserveOnly:member.reserveOnly,dt:member.dt,medicalExam:member.medicalExamAt,medicalValidUntil:member.medicalValidUntil,roles:[member.canCommand&&'COMMANDER',member.canDrive&&'DRIVER',member.canFight&&'FIREFIGHTER'].filter(Boolean) as Role[],serviceCount:0,lastService:null,unavailable:member.unavailability.map(unavailable=>({from:unavailable.from,to:unavailable.to}))};return{role:item.role as Role,member:candidate,mode:item.selectionMode};});
    const eligibilityErrors=assignments.flatMap(assignment=>eligibility(assignment.member,assignment.role,service.weekStart,service.weekEnd).reasons);
    const validation=validateCrew(assignments,minimumDt);
    if(eligibilityErrors.length||!validation.valid)return NextResponse.json({error:[...new Set([...eligibilityErrors,...validation.errors])].join('\n')},{status:422});
    await prisma.$transaction([
      prisma.weeklyService.update({where:{id},data:{status:'CONFIRMED',confirmedAt:new Date()}}),
      prisma.auditLog.create({data:{action:'CONFIRM',entity:'WeeklyService',entityId:id,description:'Týdenní posádka byla potvrzena.',actor:'Administrátor'}}),
    ]);
    const confirmed=await prisma.weeklyService.findUniqueOrThrow({where:{id},include:{assignments:{orderBy:[{role:'asc'},{slot:'asc'}]}}});
    return NextResponse.json({service:serializeWeeklyService(confirmed)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Službu se nepodařilo potvrdit.'},{status:400});}
}
