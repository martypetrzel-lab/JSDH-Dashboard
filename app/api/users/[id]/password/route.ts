import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { changePasswordSchema, hashPassword } from '@/lib/app-users';
import { getPrisma } from '@/lib/prisma';

export const runtime='nodejs';

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,input=changePasswordSchema.parse(await request.json()),prisma=getPrisma(),existing=await prisma.appUser.findUnique({where:{id},select:{id:true,username:true}});
    if(!existing)return NextResponse.json({error:'Uživatel nebyl nalezen.'},{status:404});
    const passwordHash=await hashPassword(input.password);
    await prisma.$transaction([
      prisma.appUser.update({where:{id},data:{passwordHash}}),
      prisma.adminSession.deleteMany({where:{username:existing.username}}),
      prisma.auditLog.create({data:{action:'USER_PASSWORD_CHANGED',entity:'AppUser',entityId:id,description:`Heslo uživatele ${existing.username} bylo změněno a jeho relace byly ukončeny.`,actor:'Administrátor'}}),
    ]);
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Heslo se nepodařilo změnit.'},{status:400});}
}
