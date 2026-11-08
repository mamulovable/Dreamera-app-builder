import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://placeholder-url';

// Reuse one small pool across hot reloads so dev doesn't leak connections.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };

// DATABASE_URL goes through PgBouncer (transaction mode), so prepared statements stay off.
const client = globalForDb.pgClient ?? postgres(databaseUrl, { prepare: false, max: 5 });
if (process.env.NODE_ENV !== 'production') globalForDb.pgClient = client;

export const db = drizzle({ client, schema });
export * from '@/db/schema';
