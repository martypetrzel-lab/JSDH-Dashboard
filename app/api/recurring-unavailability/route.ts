import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { recurringUnavailabilityInputSchema } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { syncServiceReplacements } from '@/lib/service-replacements-server';

export const runtime='nodejs';
const serialize=(item:{id:string;memberId:string;anchorStart:Date;durationMinutes:number;intervalMinutes:number;reason:string|null;member:{firstName:string;lastName:string}})=>({id:item.id,memberId:item.memberId,member:`${item.member.firstName} ${item.member.lastName==='—'?'':item.member.lastName}`.trim(),anchorStart:item.anchorStart.toISOString(),durationMinutes:item.durationMinutes,intervalMinutes:item.intervalMinutes,reason:item.reason??''});

export async function POST(request:Request){if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});try{const input=recurringUnavailabilityInputSchema.parse(await request.json()),prisma=getPrisma(),record=await prisma.$transaction(async tx=>{const created=await tx.recurringUnavailability.create({data:{memberId:input.memberId,anchorStart:new Date(input.anchorStart),durationMinutes:input.durationMinutes,intervalMinutes:input.intervalMinutes,reason:input.reason||null},include:{member:true}});await tx.auditLog.create({data:{action:'RECURRING_UNAVAILABILITY_CREATED',entity:'RecurringUnavailability',entityId:created.id,description:'Opakovaná pracovní směna byla vytvořena.',actor:'Administrátor'}});return created;}),services=await prisma.weeklyService.findMany({where:{assignments:{some:{memberId:input.memberId}},weekEnd:{gt:new Date()}},select:{id:true}});for(const service of services)await syncServiceReplacements(service.id);return NextResponse.json({record:serialize(record)},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Opakovanou směnu se nepodařilo uložit.'},{status:400});}}
