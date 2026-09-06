import { getPrisma } from '../lib/prisma';

const prisma = getPrisma();

await prisma.settings.upsert({
  where: { id: 'default' },
  update: {},
  create: {
    id: 'default',
    weekStartDay: 1,
    weekStartHour: 6,
    weekEndDay: 1,
    weekEndHour: 6,
    timezone: 'Europe/Prague',
    minimumDt: 1,
  },
});

await prisma.$disconnect();
console.log('Technické nastavení bylo vytvořeno. Seed neobsahuje členy ani osobní údaje.');
