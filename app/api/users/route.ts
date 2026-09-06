import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { createUserSchema, hashPassword, serializeAppUser } from '@/lib/app-users';
import { getPrisma } from '@/lib/prisma';

export const runtime='nodejs';

export async function GET(){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  const users=await getPrisma().appUser.findMany({select:{id:true,username:true,displayName:true,active:true,isAdmin:true,lastLoginAt:true,createdAt:true,updatedAt:true},orderBy:{username:'asc'}});
  return NextResponse.json({users:users.map(serializeAppUser)});
}

export async function POST(request:Request){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const input=createUserSchema.parse(await request.json()),prisma=getPrisma(),passwordHash=await hashPassword(input.password);
    const user=await prisma.$transaction(async tx=>{
      const created=await tx.appUser.create({data:{username:input.username,displayName:input.displayName,passwordHash,isAdmin:input.isAdmin},select:{id:true,username:true,displayName:true,active:true,isAdmin:true,lastLoginAt:true,createdAt:true,updatedAt:true}});
      await tx.auditLog.create({data:{action:'USER_CREATED',entity:'AppUser',entityId:created.id,description:`Uživatel ${created.username} (${created.displayName}) byl vytvořen.`,actor:'Administrátor'}});
      return created;
    });
    return NextResponse.json({user:serializeAppUser(user)},{status:201});
  }catch(error){const duplicate=error instanceof Error&&error.message.includes('Unique constraint');return NextResponse.json({error:duplicate?'Uživatelské jméno už existuje.':error instanceof Error?error.message:'Uživatele se nepodařilo vytvořit.'},{status:duplicate?409:400});}
}
