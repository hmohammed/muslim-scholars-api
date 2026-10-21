import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb, migrate, normalizeAr } from '@msapi/db';
import { loadRecords } from '../src/index.ts';
import { golden } from './fixture.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://msapi:msapi@localhost:5433/msapi_test';
const db = createDb(url);

beforeAll(async () => {
  await migrate(url);
}, 30_000);

afterAll(async () => {
  await db.destroy();
});

describe('loader', () => {
  it('keeps the SQL normaliser in step with the TypeScript one', async () => {
    for (const sample of ['أبو حنيفة', 'محمّد', 'Al-Bukhari', 'ةىأإآٱ', 'ibn al-Farooq', '']) {
      const row = await sql<{ n: string }>`select normalize_ar(${sample}) as n`.execute(db);
      expect(row.rows[0]?.n).toBe(normalizeAr(sample));
    }
  });

  it('loads parsed pages and fills only empty, unaudited columns', async () => {
    const hanifa = await golden(11001);
    const umar = await golden(3);
    const bakr = await golden(2);
    await loadRecords(url, [hanifa, umar, bakr], 'replace');

    const loaded = await db.selectFrom('scholar').select(['id', 'name_en', 'death_year_ah', 'quality_flags']).where('id', '=', 11001).executeTakeFirstOrThrow();
    expect(loaded.name_en).toBe('Abu Hanifa');
    expect(loaded.death_year_ah).toBe(150);
    const tk = await db.selectFrom('tk_entry').select(['kunya', 'death_ah']).where('scholar_id', '=', 11001).executeTakeFirstOrThrow();
    expect(tk).toEqual({ kunya: 'أبو حنيفة', death_ah: 150 });
    const narrations = await db.selectFrom('narration_count').select(['collection', 'count']).where('scholar_id', '=', 3).orderBy('collection').execute();
    expect(narrations.map(row => row.count).reduce((sum, n) => sum + n, 0)).toBe(380);
    const flags = await db.selectFrom('scholar').select('quality_flags').where('id', '=', 2).executeTakeFirstOrThrow();
    expect(flags.quality_flags).toContain('corrupt_sources');
    const sources = await db.selectFrom('source_entry').select(sql<number>`count(*)::int`.as('n')).where('scholar_id', '=', 2).executeTakeFirstOrThrow();
    expect(sources.n).toBe(0);
    const edge = await db.selectFrom('teaching_edge').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    expect(edge.n).toBeGreaterThan(0);

    await db.updateTable('scholar').set({ bio_text: null, death_place: null }).where('id', '=', 11001).execute();
    await db.insertInto('audit_log').values({ entity: 'scholar', entity_id: '11001', field: 'death_place', old: null, new: null }).execute();
    await loadRecords(url, [{
      ...hanifa,
      nameEn: 'CHANGED',
      bioText: 'filled from a later crawl',
      death: hanifa.death ? { ...hanifa.death, place: 'SHOULD NOT APPLY' } : null,
    }], 'fill-empty');

    const filled = await db.selectFrom('scholar').select(['name_en', 'bio_text', 'death_place']).where('id', '=', 11001).executeTakeFirstOrThrow();
    expect(filled.name_en).toBe('Abu Hanifa');
    expect(filled.bio_text).toBe('filled from a later crawl');
    expect(filled.death_place).toBeNull();
  });
});
