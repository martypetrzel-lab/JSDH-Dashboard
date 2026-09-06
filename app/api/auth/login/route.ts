import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAdmin, createAdminSession, loginAttemptKey } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { configurationError, getRuntimeEnv } from '@/lib/runtime-env';

export const runtime = 'nodejs';
const inputSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(500) });
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return NextResponse.json({ error: 'Vyplňte uživatelské jméno a heslo.' }, { status: 400 });
    const env = getRuntimeEnv();
    const prisma = getPrisma();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = loginAttemptKey(ip, env.SESSION_SECRET);
    const now = new Date();
    const attempt = await prisma.loginAttempt.findUnique({ where: { key } });
    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      return NextResponse.json({ error: 'Příliš mnoho pokusů. Zkuste to za několik minut.' }, { status: 429 });
    }

    const username = await authenticateAdmin(input.data.username, input.data.password);
    if (!username) {
      const inWindow = attempt && now.getTime() - attempt.windowStart.getTime() < WINDOW_MS;
      const attempts = inWindow ? attempt.attempts + 1 : 1;
      await prisma.loginAttempt.upsert({
        where: { key },
        update: { attempts, windowStart: inWindow ? attempt.windowStart : now, blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : null },
        create: { key, attempts, windowStart: now, blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : null },
      });
      return NextResponse.json({ error: 'Neplatné přihlašovací údaje.' }, { status: 401 });
    }

    await prisma.loginAttempt.deleteMany({ where: { key } });
    await createAdminSession(username);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Přihlášení selhalo:', error);
    return NextResponse.json({ error: configurationError(error) }, { status: 500 });
  }
}
