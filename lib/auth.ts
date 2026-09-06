import { createHash, randomBytes } from 'node:crypto';
import { compare } from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPrisma } from '@/lib/prisma';
import { getRuntimeEnv } from '@/lib/runtime-env';

const COOKIE_NAME = 'jsdh_admin_session';
const SESSION_HOURS = 12;

function sessionHash(token: string, secret: string) {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

export async function authenticateAdmin(username: string, password: string) {
  const env = getRuntimeEnv();
  const usernameMatches = username === env.ADMIN_USERNAME;
  const passwordMatches = await compare(password, env.ADMIN_PASSWORD_HASH);
  return usernameMatches && passwordMatches ? env.ADMIN_USERNAME : null;
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
