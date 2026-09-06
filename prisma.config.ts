import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Generate does not require a database. Migration commands still fail safely
    // when Railway or the local environment has not supplied DATABASE_URL.
    url: process.env.DATABASE_URL ?? '',
  },
});
