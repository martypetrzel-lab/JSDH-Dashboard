import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { prepareEmergencyReplacement } from '@/lib/emergency-replacement-server';
import { getPrisma } from '@/lib/prisma';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime='nodejs';
const schema=z.object({assignmentId:z.string().min(1),from:z.iso.datetime(),to:z.iso.datetime(),reason:z.string().trim().max(500).optional().default('')});
const include={assignments:{orderBy:[{role:'asc' as const},{slot:'asc' as const}]},replacements:{include:{originalMember:true,replacementMember:true},orderBy:{from:'asc' as const}}};

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,input=schema.parse(await request.json()),from=new Date(input.from),to=new Date(input.to);
    const {service,assignment,selected,issue}=await prepareEmergencyReplacement(id,input.assignmentId,from,to);
    const prisma=getPrisma();
    await prisma.$transaction(async tx=>{
      await tx.serviceReplacement.create({data:{serviceId:id,assignmentId:assignment.id,originalMemberId:assignment.memberId,replacementMemberId:selected?.id??null,role:assignment.role,from,to,valid:!!selected,issue,reason:input.reason||null,source:'MANUAL'}});
      await tx.auditLog.create({data:{action:'TEMP_REPLACEMENT_CREATED',entity:'WeeklyService',entityId:id,description:`Role ${assignment.role}; původní člen: ${assignment.nameSnapshot}; nový člen: ${selected?.name??'nenalezen'}; od: ${from.toISOString()}; do: ${to.toISOString()}; důvod: ${input.reason||'neuveden'}; stav služby: ${service.status}.`,actor:'Administrátor'}});
    });
    const updated=await prisma.weeklyService.findUniqueOrThrow({where:{id},include});
    return NextResponse.json({service:serializeWeeklyService(updated),resolved:!!selected},{status:201});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Záskok se nepodařilo vytvořit.'},{status:400});}
}
