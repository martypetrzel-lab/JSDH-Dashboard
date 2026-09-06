import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { serializeAppUser, updateUserSchema } from '@/lib/app-users';
import { getPrisma } from '@/lib/prisma';

export const runtime='nodejs';

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,input=updateUserSchema.parse(await request.json()),prisma=getPrisma(),existing=await prisma.appUser.findUnique({where:{id}});
    if(!existing)return NextResponse.json({error:'Uživatel nebyl nalezen.'},{status:404});
    const user=await prisma.$transaction(async tx=>{
      const updated=await tx.appUser.update({where:{id},data:{username:input.username,displayName:input.displayName,active:input.active,isAdmin:input.isAdmin},select:{id:true,username:true,displayName:true,active:true,isAdmin:true,lastLoginAt:true,createdAt:true,updatedAt:true}});
      if(existing.username!==updated.username||!updated.active||!updated.isAdmin)await tx.adminSession.deleteMany({where:{username:existing.username}});
      await tx.auditLog.create({data:{action:'USER_UPDATED',entity:'AppUser',entityId:id,description:`Uživatel ${existing.username} byl upraven na ${updated.username}; jméno: ${updated.displayName}; aktivní: ${updated.active}; administrátor: ${updated.isAdmin}.`,actor:'Administrátor'}});
      return updated;
    });
    return NextResponse.json({user:serializeAppUser(user)});
  }catch(error){const duplicate=error instanceof Error&&error.message.includes('Unique constraint');return NextResponse.json({error:duplicate?'Uživatelské jméno už existuje.':error instanceof Error?error.message:'Uživatele se nepodařilo upravit.'},{status:duplicate?409:400});}
}

export async function DELETE(_request:Request,context:{params:Promise<{id:string}>}){
  if(!(await requireAdminApi()))return NextResponse.json({error:'Nepřihlášený přístup.'},{status:401});
  try{
    const {id}=await context.params,prisma=getPrisma(),existing=await prisma.appUser.findUnique({where:{id}});
    if(!existing)return NextResponse.json({error:'Uživatel nebyl nalezen.'},{status:404});
    const user=await prisma.$transaction(async tx=>{
      const disabled=await tx.appUser.update({where:{id},data:{active:false},select:{id:true,username:true,displayName:true,active:true,isAdmin:true,lastLoginAt:true,createdAt:true,updatedAt:true}});
      await tx.adminSession.deleteMany({where:{username:existing.username}});
      await tx.auditLog.create({data:{action:'USER_DISABLED',entity:'AppUser',entityId:id,description:`Uživatel ${existing.username} byl deaktivován a jeho relace byly ukončeny.`,actor:'Administrátor'}});
      return disabled;
    });
    return NextResponse.json({user:serializeAppUser(user)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Uživatele se nepodařilo deaktivovat.'},{status:400});}
}
