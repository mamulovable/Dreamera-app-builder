import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations need a direct connection; DATABASE_URL is pooled when DIRECT_URL is set.
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:password@localhost:5432/mydb',
  },
  tablesFilter: ['!pg_stat_monitor*', '!pg_stat_statements*'],
});
