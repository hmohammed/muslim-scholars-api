import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { buildDataset, createDb, DATASET_FILES, migrate } from '@msapi/db';
import type { FastifyInstance } from 'fastify';
import { readStoredZip } from '../../db/src/zip.ts';
import { createKey } from '../src/auth/keys.ts';
import { buildApp } from '../src/app.ts';
import { testAuth } from './auth-config.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://msapi:msapi@localhost:5433/msapi_test';
const version = 'test-m7';
const db = createDb(url);
let app: FastifyInstance;
let directory: string;
let token: string;

beforeAll(async () => {
  await migrate(url);
  await db.deleteFrom('dataset_release').where('version', '=', version).execute();
  directory = await mkdtemp(join(tmpdir(), 'msapi-dataset-'));
  await buildDataset({ connectionString: url, directory, version, notes: 'test release' });
  app = await buildApp({ db, logLevel: 'silent', datasetDir: directory, auth: testAuth });
  await db.insertInto('account').values({ github_id: 900002, login: 'dataset-tester', role: 'developer' })
    .onConflict(oc => oc.column('github_id').doNothing())
    .execute();
  const account = await db.selectFrom('account').select('id').where('github_id', '=', 900002).executeTakeFirstOrThrow();
  token = (await createKey(db, Number(account.id), 'dataset', testAuth.pepper, { perSecond: 100, perDay: 1000 })).token;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db.deleteFrom('dataset_release').where('version', '=', version).execute();
  await db.destroy();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('dataset downloads', () => {
  it('writes sqlite, json and csv with the public tables only', async () => {
    const books = await db.selectFrom('source_book').select(sql<number>`count(*)::int`.as('count')).executeTakeFirstOrThrow();
    const sqlite = new DatabaseSync(join(directory, version, DATASET_FILES.sqlite));
    try {
      const exported = sqlite.prepare('SELECT count(*) AS count FROM source_book').get() as { count: number };
      expect(exported.count).toBe(books.count);
      expect(books.count).toBeGreaterThan(0);
      const names = (sqlite.prepare('PRAGMA table_info(scholar)').all() as { name: string }[]).map(row => row.name);
      expect(names).not.toContain('search_name');
      expect(names).not.toContain('bio_tsv');
      const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
        .map(row => row.name);
      expect(tables).not.toContain('account');
      expect(tables).not.toContain('api_key');
      expect(tables).toContain('teaching_edge');
    } finally {
      sqlite.close();
    }

    const json = JSON.parse(await readFile(join(directory, version, DATASET_FILES.json), 'utf8')) as {
      version: string;
      source_url: string;
      tables: { source_book: unknown[]; scholar: { id: number; name_en: string }[] };
    };
    expect(json.version).toBe(version);
    expect(json.source_url).toContain('muslimscholars.info');
    expect(json.tables.source_book).toHaveLength(books.count);
    expect(json.tables.scholar.every(row => typeof row.id === 'number' && typeof row.name_en === 'string')).toBe(true);

    const zip = readStoredZip(await readFile(join(directory, version, DATASET_FILES.csv)));
    const bookCsv = zip.get('source_book.csv')?.toString('utf8') ?? '';
    const lines = bookCsv.trim().split('\n');
    expect(lines[0]).toBe('id,name_en,name_ar,author');
    expect(lines).toHaveLength(books.count + 1);
    const rumuz = zip.get('rumuz.csv')?.toString('utf8') ?? '';
    expect(rumuz).toContain('"Nasa\'i, Amal al-yawm wa al-layla"');
    expect(zip.has('account.csv')).toBe(false);
  });

  it('serves the version without an API key', async () => {
    const list = await app.inject('/datasets');
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([expect.objectContaining({
      version,
      notes: 'test release',
      rows: expect.objectContaining({ source_book: expect.any(Number) }),
      files: expect.arrayContaining([
        expect.objectContaining({ name: DATASET_FILES.sqlite, href: `/datasets/${version}/${DATASET_FILES.sqlite}` }),
        expect.objectContaining({ name: DATASET_FILES.json }),
        expect.objectContaining({ name: DATASET_FILES.csv }),
      ]),
    })]);

    const one = await app.inject(`/datasets/${version}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().version).toBe(version);

    const file = await app.inject(`/datasets/${version}/${DATASET_FILES.sqlite}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('sqlite');
    expect(file.headers['content-disposition']).toContain(DATASET_FILES.sqlite);
    expect(file.body.startsWith('SQLite format 3')).toBe(true);

    const missing = await app.inject('/datasets/a%20b');
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');

    const catalog = await app.inject('/datasets/catalog');
    expect(catalog.statusCode).toBe(200);
    expect(catalog.headers['access-control-allow-origin']).toBe('*');
    const body = catalog.json() as { scholars: { id: number; name_en: string; areas: string[] }[]; edges: number[][] };
    expect(body.scholars.length).toBeGreaterThan(0);
    expect(body.scholars[0]).toEqual(expect.objectContaining({ id: expect.any(Number), name_en: expect.any(String) }));
    expect(Array.isArray(body.edges)).toBe(true);

    const spec = await app.inject('/openapi.json');
    const paths = Object.keys(spec.json().paths as Record<string, unknown>);
    expect(paths).toContain('/datasets');
    expect(paths).toContain('/datasets/catalog');
    expect(paths).toContain(`/datasets/{version}/${DATASET_FILES.json}`);

    const meta = await app.inject({ url: '/v1/meta', headers: { 'x-api-key': token } });
    expect(meta.json().data.downloads).toEqual({ href: '/datasets', latest: version });
  });
});
