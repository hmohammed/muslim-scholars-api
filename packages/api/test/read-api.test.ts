import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createDb, migrate } from '@msapi/db';
import { loadRecords } from '../../importer/src/index.ts';
import { golden, scholar } from '../../importer/test/fixture.ts';
import { createKey } from '../src/auth/keys.ts';
import { buildApp } from '../src/app.ts';
import { testAuth } from './auth-config.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://msapi:msapi@localhost:5433/msapi_test';
const db = createDb(url);
let app: FastifyInstance;

beforeAll(async () => {
  await migrate(url);
  const ids = [1, 2, 3, 11001, 14110, 20003, 30001, 30003, 40010];
  const records = await Promise.all(ids.map(id => golden(id)));
  const bukhari = records.find(record => record.id === 30001);
  if (!bukhari) throw new Error('missing Bukhari fixture');
  bukhari.relations.push({ type: 'teacher', id: 80002, name: 'Chain Teacher', position: 900 });
  records.push(
    scholar({
      id: 80001,
      nameEn: 'Chain Start',
      nameAr: 'بداية السند',
      category: 'century_3',
      relations: [{ type: 'teacher', id: 80002, name: 'Chain Middle', position: 0 }],
    }),
    scholar({
      id: 80002,
      nameEn: 'Chain Middle',
      category: 'follower',
      relations: [{ type: 'teacher', id: 80003, name: 'Chain Companion', position: 0 }],
    }),
    scholar({
      id: 80003,
      nameEn: 'Chain Companion',
      category: 'companion',
      relations: [{ type: 'student', id: 80002, name: 'Chain Middle', position: 0 }],
    }),
  );
  await loadRecords(url, records, 'replace');
  app = await buildApp({ db, logLevel: 'silent', auth: testAuth });
  await db.insertInto('account').values({ github_id: 900001, login: 'tester', role: 'developer' })
    .onConflict(oc => oc.column('github_id').doNothing())
    .execute();
  const account = await db.selectFrom('account').select('id').where('github_id', '=', 900001).executeTakeFirstOrThrow();
  const token = (await createKey(db, Number(account.id), 'read-api', testAuth.pepper, { perSecond: 1000, perDay: 100_000 })).token;
  const inject = app.inject.bind(app) as (opts: string | InjectOptions) => Promise<LightMyRequestResponse>;
  app.inject = ((opts: string | InjectOptions) => {
    if (typeof opts === 'string') {
      return opts.startsWith('/v1') ? inject({ url: opts, headers: { 'x-api-key': token } }) : inject(opts);
    }
    const path = typeof opts.url === 'string' ? opts.url : '';
    if (!path.startsWith('/v1')) return inject(opts);
    return inject({ ...opts, headers: { 'x-api-key': token, ...(opts.headers ?? {}) } });
  }) as typeof app.inject;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db.destroy();
});

describe('read API', () => {
  it('lists, filters and pages with an API key', async () => {
    const page = await app.inject({ url: '/v1/scholars', query: { limit: '1', sort: 'id' } });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('application/json');
    const first = page.json();
    expect(first.data).toHaveLength(1);
    expect(first.attribution.compiler).toBe('Arees Institute');
    expect(first.meta.next_cursor).toBeTypeOf('string');

    const second = await app.inject({ url: '/v1/scholars', query: { limit: '1', sort: 'id', cursor: first.meta.next_cursor } });
    expect(second.statusCode).toBe(200);
    expect(second.json().data[0].id).toBeGreaterThan(first.data[0].id);

    const companions = await app.inject({ url: '/v1/scholars', query: { category: 'companion', limit: '100' } });
    const companionIds = companions.json().data.map((row: { id: number }) => row.id);
    expect(companionIds).toContain(2);
    expect(companionIds).not.toContain(11001);

    const thiqah = await app.inject({ url: '/v1/scholars', query: { grade: 'Thiqah', limit: '100' } });
    expect(thiqah.json().data.map((row: { id: number }) => row.id)).toContain(11001);

    const baghdad = await app.inject({ url: '/v1/scholars', query: { place: 'Baghdad', limit: '100' } });
    expect(baghdad.json().data.map((row: { id: number }) => row.id)).toContain(11001);

    const withTk = await app.inject({ url: '/v1/scholars', query: { has_tk: 'true', limit: '100' } });
    expect(withTk.json().data.map((row: { id: number }) => row.id)).toContain(11001);

    const noBio = await app.inject({ url: '/v1/scholars', query: { has_bio: 'false', limit: '100' } });
    expect(noBio.json().data.map((row: { id: number }) => row.id)).toContain(80001);

    const years = await app.inject({ url: '/v1/scholars', query: { death_from: '200', death_to: '260', limit: '100' } });
    const yearIds = years.json().data.map((row: { id: number }) => row.id);
    expect(yearIds).toContain(30001);
    expect(yearIds).not.toContain(11001);

    const named = await app.inject({ url: '/v1/scholars', query: { q: 'Hanifa', limit: '20' } });
    expect(named.json().data.map((row: { id: number }) => row.id)).toContain(11001);

    const text = await app.inject({ url: '/v1/scholars', query: { text: 'Jurisprudence', limit: '20' } });
    expect(text.json().data.map((row: { id: number }) => row.id)).toContain(11001);

    const bad = await app.inject({ url: '/v1/scholars', query: { category: 'not-a-category' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['content-type']).toContain('application/problem+json');
  });

  it('returns detail, includes, relations and sources', async () => {
    const detail = await app.inject({ url: '/v1/scholars/11001', query: { include: 'tk,rumuz,narrations,variants' } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json().data;
    expect(body.name.en).toBe('Abu Hanifa');
    expect(body.death.year_ah).toBe(150);
    expect(body.tk.kunya).toBe('أبو حنيفة');
    expect(body.rumuz.map((row: { code: string }) => row.code)).toEqual(expect.arrayContaining(['ت', 'س']));
    expect(body.source_url).toContain('ID=11001');

    const relations = await app.inject({ url: '/v1/scholars/3/relations', query: { type: 'parent' } });
    expect(relations.statusCode).toBe(200);
    expect(relations.json().data.length).toBeGreaterThan(0);
    expect(relations.json().data.every((row: { type: string }) => row.type === 'parent')).toBe(true);

    const sources = await app.inject({ url: '/v1/scholars/11001/sources' });
    expect(sources.json().data.length).toBeGreaterThan(0);
    const missing = await app.inject('/v1/scholars/999999');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().title).toBe('Not Found');
  });

  it('searches names in English and Arabic and ranks an exact match first', async () => {
    const english = await app.inject({ url: '/v1/search', query: { q: 'bukhari', lang: 'en' } });
    expect(english.statusCode).toBe(200);
    expect(english.json().data[0].id).toBe(30001);

    const arabic = await app.inject({ url: '/v1/search', query: { q: 'البخاري', lang: 'ar' } });
    expect(arabic.json().data.map((row: { id: number }) => row.id)).toContain(30001);

    const latinOnly = await app.inject({ url: '/v1/search', query: { q: 'bukhari', lang: 'ar' } });
    expect(latinOnly.json().data.map((row: { id: number }) => row.id)).not.toContain(30001);

    const exact = await app.inject({ url: '/v1/search', query: { q: 'Chain Start', lang: 'en' } });
    expect(exact.json().data[0]).toMatchObject({ id: 80001, rank: 0 });
  });

  it('serves lookups, stats and meta', async () => {
    const areas = await app.inject('/v1/areas?limit=100');
    expect(areas.json().data.map((row: { name: string }) => row.name)).toContain('Fiqh');
    const tags = await app.inject('/v1/tags?limit=200');
    expect(tags.json().data.length).toBeGreaterThan(0);
    const places = await app.inject('/v1/places?limit=200');
    expect(places.json().data.map((row: { name: string }) => row.name)).toContain('Baghdad');
    const books = await app.inject('/v1/books?limit=20');
    expect(books.json().data.some((row: { count: number }) => row.count > 0)).toBe(true);
    const rumuz = await app.inject('/v1/rumuz?limit=50');
    expect(rumuz.json().data.map((row: { name: string }) => row.name)).toContain('ت');

    const stats = await app.inject('/v1/stats');
    expect(stats.json().data.scholars).toBeGreaterThan(5);
    expect(stats.json().data.category.length).toBeGreaterThan(0);

    const meta = await app.inject('/v1/meta');
    expect(meta.json().data.attribution.work).toBe('Muslim Scholars Database');
    expect(meta.json().attribution.source_url).toContain('muslimscholars.info');
  });

  it('combines teacher and student links and returns a Bukhari-to-Companion chain in under 50 ms', async () => {
    const teachers = await app.inject('/v1/scholars/80002/teachers');
    expect(teachers.json().data.map((row: { id: number }) => row.id)).toEqual([80003]);
    const students = await app.inject('/v1/scholars/80003/students');
    expect(students.json().data.map((row: { id: number }) => row.id)).toContain(80002);

    const network = await app.inject({ url: '/v1/scholars/80002/network', query: { depth: '1' } });
    const nodeIds = network.json().data.nodes.map((row: { id: number }) => row.id);
    expect(nodeIds).toEqual(expect.arrayContaining([80001, 80002, 80003]));
    expect(network.json().data.edges).toEqual(expect.arrayContaining([
      { teacher_id: 80003, student_id: 80002 },
      { teacher_id: 80002, student_id: 80001 },
    ]));

    const chain = await app.inject({ url: '/v1/scholars/80001/chain', query: { to: 'companions' } });
    expect(chain.statusCode).toBe(200);
    expect(chain.json().data.paths[0].map((row: { id: number }) => row.id)).toEqual([80001, 80002, 80003]);
    expect(chain.json().data.elapsed_ms).toBeLessThan(50);

    const bukhari = await app.inject({ url: '/v1/scholars/30001/chain', query: { to: 'companions', max_depth: '16' } });
    expect(bukhari.statusCode).toBe(200);
    const paths = bukhari.json().data.paths as { id: number; category: string }[][];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path[0]?.id).toBe(30001);
      expect(path.at(-1)?.category).toBe('companion');
    }
    expect(bukhari.json().data.elapsed_ms).toBeLessThan(50);

    const toId = await app.inject({ url: '/v1/scholars/80001/chain', query: { to: '80003' } });
    expect(toId.json().data.paths[0].map((row: { id: number }) => row.id)).toEqual([80001, 80002, 80003]);
  });

  it('documents every v1 route and the attribution page', async () => {
    const spec = await app.inject('/openapi.json');
    const paths = Object.keys(spec.json().paths);
    for (const path of [
      '/healthz', '/v1/scholars', '/v1/scholars/{id}', '/v1/scholars/{id}/relations',
      '/v1/scholars/{id}/teachers', '/v1/scholars/{id}/students', '/v1/scholars/{id}/network',
      '/v1/scholars/{id}/chain', '/v1/scholars/{id}/sources', '/v1/search',
      '/v1/areas', '/v1/tags', '/v1/places', '/v1/books', '/v1/rumuz', '/v1/stats', '/v1/meta',
    ]) expect(paths).toContain(path);
    expect(paths.some(path => path.startsWith('/portal') || path.startsWith('/admin'))).toBe(false);

    const docs = await app.inject('/docs/');
    expect(docs.statusCode).toBe(200);
    const attribution = await app.inject('/docs/attribution');
    expect(attribution.statusCode).toBe(200);
    expect(attribution.headers['content-type']).toContain('text/html');
    expect(attribution.body).toContain('Arees');

    const missing = await app.inject('/v1/nope');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
  });
});
