import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { pgConfig } from './pg-config.ts';
import type { Database } from './schema.ts';

export type { Database, DeathCause, Madhhab, RelationType, ScholarCategory, ScholarGrade } from './schema.ts';
export { migrate } from './migrate.ts';
export { normalizeAr } from './normalize.ts';
export { pgConfig } from './pg-config.ts';

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ ...pgConfig(connectionString), max: 10 }) }),
  });
}
