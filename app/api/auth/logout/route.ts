import { NextResponse } from 'next/server';
import { destroyAdminSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  await destroyAdminSession();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
