import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { parseActivityDate } from '@/lib/conditioning';
import { driverActivityInputSchema, nullable, serializeDriverActivity } from '@/lib/conditioning-data';
import { getPrisma } from '@/lib/prisma';

export const runtime='nodejs';
export async function POST(request:Request){if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});try{const input=driverActivityInputSchema.parse(await request.json()),prisma=getPrisma();const activity=await prisma.$transaction(async tx=>{const member=await tx.member.findUnique({where:{id:input.memberId},select:{canDrive:true,active:true,systemAccount:true}});if(!member?.active||!member.canDrive||member.systemAccount)throw new Error('Jízdu lze zapsat pouze aktivnímu strojníkovi.');const created=await tx.driverActivity.create({data:{memberId:input.memberId,date:parseActivityDate(input.date),type:input.type,vehicle:input.vehicle,kilometers:input.kilometers,incidentReference:nullable(input.incidentReference),note:nullable(input.note)}});await tx.auditLog.create({data:{action:'CREATE',entity:'DriverActivity',entityId:created.id,description:'Jízda strojníka byla vytvořena.',actor:'Administrátor'}});return created;});return NextResponse.json({activity:serializeDriverActivity(activity)},{status:201});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Jízdu se nepodařilo uložit.'},{status:400});}}
