import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime='nodejs';
const schema=z.object({reason:z.string().trim().max(500).optional().default('')});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,{reason}=schema.parse(await request.json()),prisma=getPrisma(),service=await prisma.weeklyService.findUnique({where:{id}});
    if(!service)return NextResponse.json({error:'Služba nebyla nalezena.'},{status:404});
    if(service.status==='CANCELLED')return NextResponse.json({error:'Služba už je zrušena.'},{status:409});
    const cancelled=await prisma.$transaction(async tx=>{
      await tx.weeklyService.update({where:{id},data:{status:'CANCELLED',cancelledAt:new Date(),cancellationReason:reason||null}});
      await tx.auditLog.create({data:{action:'SERVICE_CANCELLED',entity:'WeeklyService',entityId:id,description:`Služba ${service.weekStart.toISOString()} byla zrušena; důvod: ${reason||'neuveden'}; předchozí stav: ${service.status}.`,actor:'Administrátor'}});
      return tx.weeklyService.findUniqueOrThrow({where:{id},include:{assignments:{orderBy:[{role:'asc'},{slot:'asc'}]},replacements:{include:{originalMember:true,replacementMember:true},orderBy:{from:'asc'}}}});
    });
    return NextResponse.json({service:serializeWeeklyService(cancelled)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Službu se nepodařilo zrušit.'},{status:400});}
}
