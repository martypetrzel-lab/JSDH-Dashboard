import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPrisma } from '@/lib/prisma';
import { getRuntimeEnv } from '@/lib/runtime-env';
import { authenticateWithSources } from '@/lib/auth-credentials';

const COOKIE_NAME = 'jsdh_admin_session';
const SESSION_HOURS = 12;

function sessionHash(token: string, secret: string) {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

export async function authenticateAdmin(username: string, password: string) {
  const env = getRuntimeEnv();
  const prisma = getPrisma();
  const result=await authenticateWithSources(username,password,{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD},value=>prisma.appUser.findUnique({where:{username:value},select:{id:true,username:true,passwordHash:true,active:true,isAdmin:true}}));
  if(!result)return null;
  await prisma.$transaction(async tx=>{
    if(result.userId)await tx.appUser.update({where:{id:result.userId},data:{lastLoginAt:new Date()}});
    await tx.auditLog.create({data:{action:'USER_LOGIN',entity:'AppUser',entityId:result.userId??'env-superadmin',description:`Uživatel ${result.username} se úspěšně přihlásil${result.userId?' databázovým účtem':' nouzovým ENV účtem'}.`,actor:result.username}});
  });
  return result.username;
}

export async function createAdminSession(username: string) {
  const env = getRuntimeEnv();
  const prisma = getPrisma();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await prisma.adminSession.create({ data: { tokenHash: sessionHash(token, env.SESSION_SECRET), username, expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getAdminSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const env = getRuntimeEnv();
  const prisma = getPrisma();
  const session = await prisma.adminSession.findUnique({ where: { tokenHash: sessionHash(token, env.SESSION_SECRET) } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if(session.username!==env.ADMIN_USERNAME){
    const user=await prisma.appUser.findUnique({where:{username:session.username},select:{active:true,isAdmin:true}});
    if(!user?.active||!user.isAdmin){await prisma.adminSession.delete({where:{id:session.id}}).catch(()=>undefined);return null;}
  }
  return { username: session.username, expiresAt: session.expiresAt };
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdminApi() {
  return Boolean(await getAdminSession());
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    const env = getRuntimeEnv();
    await getPrisma().adminSession.deleteMany({ where: { tokenHash: sessionHash(token, env.SESSION_SECRET) } });
  }
  cookieStore.set(COOKIE_NAME, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}

export function loginAttemptKey(ip: string, secret: string) {
  return createHash('sha256').update(`${secret}:login:${ip}`).digest('hex');
}
