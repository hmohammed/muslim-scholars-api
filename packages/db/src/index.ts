import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.ts';

export type { Database, DeathCause, Madhhab, RelationType, ScholarCategory, ScholarGrade } from './schema.ts';
export { migrate } from './migrate.ts';
export { normalizeAr } from './normalize.ts';

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: 10 }) }),
  });
}
