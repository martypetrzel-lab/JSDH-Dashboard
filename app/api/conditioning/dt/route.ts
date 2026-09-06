import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { parseActivityDate } from '@/lib/conditioning';
import { dtActivityInputSchema, nullable, serializeDtActivity } from '@/lib/conditioning-data';
import { getPrisma } from '@/lib/prisma';

export const runtime='nodejs';
export async function POST(request:Request){if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});try{const input=dtActivityInputSchema.parse(await request.json()),prisma=getPrisma();const activity=await prisma.$transaction(async tx=>{const member=await tx.member.findUnique({where:{id:input.memberId},select:{dt:true,active:true,systemAccount:true}});if(!member?.active||!member.dt||member.systemAccount)throw new Error('DT událost lze zapsat pouze aktivnímu nositeli DT.');const created=await tx.dtActivity.create({data:{memberId:input.memberId,date:parseActivityDate(input.date),type:input.type,cylinderNumber:nullable(input.cylinderNumber),carrierNumber:nullable(input.carrierNumber),maskNumber:nullable(input.maskNumber),incidentReference:nullable(input.incidentReference),note:nullable(input.note)}});await tx.auditLog.create({data:{action:'CREATE',entity:'DtActivity',entityId:created.id,description:'Událost dýchací techniky byla vytvořena.',actor:'Administrátor'}});return created;});return NextResponse.json({activity:serializeDtActivity(activity)},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'DT událost se nepodařilo uložit.'},{status:400});}}
