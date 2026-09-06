import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { jsdhPrisma?: PrismaClient };

export function getPrisma() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Chybí povinné proměnné prostředí: DATABASE_URL');

  const prisma = globalForPrisma.jsdhPrisma ?? new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  if (process.env.NODE_ENV !== 'production') globalForPrisma.jsdhPrisma = prisma;
  return prisma;
}
