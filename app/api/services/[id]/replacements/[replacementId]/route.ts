import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { prepareEmergencyReplacement } from '@/lib/emergency-replacement-server';
import { getPrisma } from '@/lib/prisma';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime='nodejs';
const schema=z.object({from:z.iso.datetime(),to:z.iso.datetime(),reason:z.string().trim().max(500).optional().default(''),replacementMemberId:z.string().min(1).nullable().optional(),forceManualOverride:z.boolean().optional().default(false)});
const include={assignments:{orderBy:[{role:'asc' as const},{slot:'asc' as const}]},replacements:{include:{originalMember:true,replacementMember:true},orderBy:{from:'asc' as const}},temporaryAssignments:{include:{member:true},orderBy:[{from:'asc' as const},{role:'asc' as const},{slot:'asc' as const}]}};
const auditWarnings=(warnings:string[])=>[...new Set(warnings.map(warning=>warning.toLocaleLowerCase('cs').includes('zdravot')?'zdravotní pravidlo':warning))].join(', ');

export async function PATCH(request:Request,context:{params:Promise<{id:string;replacementId:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id,replacementId}=await context.params,input=schema.parse(await request.json()),prisma=getPrisma(),record=await prisma.serviceReplacement.findUnique({where:{id:replacementId},include:{replacementMember:true}});
    if(!record||record.serviceId!==id)return NextResponse.json({error:'Záskok nebyl nalezen.'},{status:404});
    const from=new Date(input.from),to=new Date(input.to),{service,assignment,selected,issue,selectedWarnings}=await prepareEmergencyReplacement(id,record.assignmentId,from,to,replacementId,input.replacementMemberId,input.forceManualOverride),otherInvalid=await prisma.serviceReplacement.count({where:{serviceId:id,id:{not:replacementId},valid:false}}),manualOverride=Boolean(input.replacementMemberId&&input.forceManualOverride&&selectedWarnings.length),warningText=manualOverride?` Varování: ${auditWarnings(selectedWarnings)}.`:'';
    await prisma.$transaction([
      prisma.serviceReplacement.update({where:{id:replacementId},data:{originalMemberId:assignment.memberId,replacementMemberId:selected?.id??null,role:assignment.role,from,to,valid:!!selected,issue:manualOverride?null:issue,reason:input.reason||null,source:'MANUAL',manualOverride}}),
      prisma.auditLog.create({data:{action:manualOverride?'TEMP_REPLACEMENT_MANUAL_OVERRIDE':'TEMP_REPLACEMENT_CHANGED',entity:'WeeklyService',entityId:id,description:`Role ${assignment.role}; původní náhradník: ${record.replacementMember?`${record.replacementMember.firstName} ${record.replacementMember.lastName}`:'nenalezen'}; nový náhradník: ${selected?.name??'nenalezen'}; od: ${from.toISOString()}; do: ${to.toISOString()}; důvod: ${input.reason||'neuveden'}.${warningText}`,actor:'Administrátor'}}),
      ...(selected&&otherInvalid===0&&service.crewIssue?.includes('nepodařilo se automaticky sestavit náhradní posádku')?[prisma.weeklyService.update({where:{id},data:{needsCrewChange:false,crewIssue:null}})]:[]),
    ]);
    const updated=await prisma.weeklyService.findUniqueOrThrow({where:{id},include});
    return NextResponse.json({service:serializeWeeklyService(updated),resolved:!!selected});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Záskok se nepodařilo změnit.'},{status:400});}
}

export async function DELETE(_request:Request,context:{params:Promise<{id:string;replacementId:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id,replacementId}=await context.params,prisma=getPrisma(),record=await prisma.serviceReplacement.findUnique({where:{id:replacementId},include:{originalMember:true,replacementMember:true}});
    if(!record||record.serviceId!==id||record.source!=='MANUAL')return NextResponse.json({error:'Ruční záskok nebyl nalezen.'},{status:404});
    await prisma.$transaction([
      prisma.serviceReplacement.delete({where:{id:replacementId}}),
      prisma.auditLog.create({data:{action:'TEMP_REPLACEMENT_REMOVED',entity:'WeeklyService',entityId:id,description:`Role ${record.role}; původní člen: ${record.originalMember.firstName} ${record.originalMember.lastName}; náhradník: ${record.replacementMember?`${record.replacementMember.firstName} ${record.replacementMember.lastName}`:'nenalezen'}; od: ${record.from.toISOString()}; do: ${record.to.toISOString()}; důvod: ${record.reason??'neuveden'}.`,actor:'Administrátor'}}),
    ]);
    const updated=await prisma.weeklyService.findUniqueOrThrow({where:{id},include});
    return NextResponse.json({service:serializeWeeklyService(updated)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Záskok se nepodařilo odstranit.'},{status:400});}
}
