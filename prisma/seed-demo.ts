import { getPrisma } from '../lib/prisma';

const prisma = getPrisma();
const demoMembers = [
  { firstName: 'Adam', lastName: 'Novotný', primaryRole: 'UNIT_COMMANDER', canCommand: true, canFight: true, dt: true },
  { firstName: 'Petr', lastName: 'Dvořák', primaryRole: 'DRIVER', canDrive: true, canFight: true, dt: false },
  { firstName: 'Eva', lastName: 'Procházková', primaryRole: 'FIREFIGHTER', canFight: true, dt: true },
  { firstName: 'Lukáš', lastName: 'Černý', primaryRole: 'FIREFIGHTER', canFight: true, dt: false },
] as const;

await prisma.$transaction([
  prisma.settings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } }),
  ...demoMembers.map((member, index) => prisma.member.create({
    data: {
      ...member,
      medicalExamAt: new Date(Date.UTC(2026, index, 15, 12)),
      medicalValidUntil: new Date(Date.UTC(2028, index, 15, 12)),
    },
  })),
]);

await prisma.$disconnect();
console.log('Demonstrační databáze byla naplněna výhradně fiktivními osobami.');
