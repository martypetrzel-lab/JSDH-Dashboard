import { hashPassword, USER_PASSWORD_MIN_LENGTH } from '../lib/app-users';
import { getPrisma } from '../lib/prisma';

const definitions=[
  {username:'MartinB',displayName:'Martin Bradáč',environmentName:'BOOTSTRAP_MARTINB_PASSWORD'},
  {username:'MilanH',displayName:'Milan Hél',environmentName:'BOOTSTRAP_MILANH_PASSWORD'},
] as const;

const missing=definitions.filter(item=>!process.env[item.environmentName]?.trim()).map(item=>item.environmentName);
if(missing.length)throw new Error(`Chybí dočasné bootstrap proměnné: ${missing.join(', ')}`);
const tooShort=definitions.filter(item=>process.env[item.environmentName]!.length<USER_PASSWORD_MIN_LENGTH).map(item=>item.environmentName);
if(tooShort.length)throw new Error(`Heslo v ${tooShort.join(', ')} musí mít alespoň ${USER_PASSWORD_MIN_LENGTH} znaků.`);

const prisma=getPrisma();
try{
  for(const definition of definitions){
    const passwordHash=await hashPassword(process.env[definition.environmentName]!);
    const existing=await prisma.appUser.findUnique({where:{username:definition.username},select:{id:true}});
    const user=await prisma.$transaction(async tx=>{
      const saved=await tx.appUser.upsert({where:{username:definition.username},update:{displayName:definition.displayName,passwordHash,active:true,isAdmin:true},create:{username:definition.username,displayName:definition.displayName,passwordHash,active:true,isAdmin:true}});
      await tx.auditLog.create({data:{action:existing?'USER_UPDATED':'USER_CREATED',entity:'AppUser',entityId:saved.id,description:`Bootstrap účtu ${definition.username} byl dokončen.`,actor:'users:bootstrap'}});
      return saved;
    });
    void user;
    console.log(`Uživatel ${definition.username} vytvořen.`);
  }
}finally{
  await prisma.$disconnect();
}
