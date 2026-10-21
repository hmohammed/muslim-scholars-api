import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createDb, migrate } from '@msapi/db';
import { createKey, TRY_IT_TOKEN } from '../src/auth/keys.ts';
import { buildApp } from '../src/app.ts';
import { testAuth } from './auth-config.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://msapi:msapi@localhost:5433/msapi_test';
const db = createDb(url);
let app: FastifyInstance;

function cookieHeader(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  return list.map(item => item.split(';')[0]).filter(Boolean).join('; ');
}

async function signIn(code: string): Promise<string> {
  const login = await app.inject({ url: '/portal/login', query: { next: '/portal' } });
  expect(login.statusCode).toBe(302);
  const state = new URL(String(login.headers.location)).searchParams.get('state');
  const callback = await app.inject({
    url: '/portal/callback',
    query: { code, state: state ?? '' },
    headers: { cookie: cookieHeader(login.headers['set-cookie'] as string | string[] | undefined) },
  });
  expect(callback.statusCode).toBe(302);
  return cookieHeader(callback.headers['set-cookie'] as string | string[] | undefined);
}

beforeAll(async () => {
  await migrate(url);
  app = await buildApp({ db, logLevel: 'silent', auth: testAuth });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await db.destroy();
});

describe('accounts and keys', () => {
  it('signs in, creates a key, calls the API, and rejects the key after revoke', async () => {
    const session = await signIn('admin');
    const home = await app.inject({ url: '/portal', headers: { cookie: session } });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('ada');
    const csrf = home.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';

    const created = await app.inject({
      method: 'POST',
      url: '/portal/keys',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ csrf, name: 'laptop' }).toString(),
    });
    expect(created.statusCode).toBe(303);
    const issued = await app.inject({
      url: String(created.headers.location),
      headers: { cookie: session },
    });
    const token = issued.body.match(/msk_live_[A-Za-z0-9_]+/)?.[0];
    expect(token).toBeTruthy();

    const allowed = await app.inject({ url: '/v1/scholars', headers: { 'x-api-key': token } });
    expect(allowed.statusCode).toBe(200);

    const missing = await app.inject('/v1/scholars');
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['content-type']).toContain('application/problem+json');

    const portal = await app.inject({ url: '/portal', headers: { cookie: session } });
    const revoke = portal.body.match(/action="(\/portal\/keys\/\d+\/revoke)"/)?.[1];
    const revokeCsrf = portal.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    const revoked = await app.inject({
      method: 'POST',
      url: revoke ?? '',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ csrf: revokeCsrf }).toString(),
    });
    expect(revoked.statusCode).toBe(303);
    const blocked = await app.inject({ url: '/v1/scholars', headers: { 'x-api-key': token } });
    expect(blocked.statusCode).toBe(401);
  });

  it('enforces the per-second limit and the shared Try it key per IP', async () => {
    const account = await db.selectFrom('account').select('id').where('login', '=', 'ada').executeTakeFirstOrThrow();
    const limited = await createKey(db, Number(account.id), 'limited', testAuth.pepper, { perSecond: 1, perDay: 1000 });
    const first = await app.inject({ url: '/v1/scholars', headers: { 'x-api-key': limited.token } });
    const second = await app.inject({ url: '/v1/scholars', headers: { 'x-api-key': limited.token } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);

    const hit = (ip: string) => app.inject({
      url: '/v1/scholars',
      headers: { 'x-api-key': TRY_IT_TOKEN, 'x-forwarded-for': ip },
    });
    const one = await hit('203.0.113.10');
    const two = await hit('203.0.113.10');
    const three = await hit('203.0.113.10');
    const other = await hit('203.0.113.11');
    expect([one.statusCode, two.statusCode, three.statusCode].filter(code => code === 429).length).toBeGreaterThan(0);
    expect(other.statusCode).toBe(200);
  });

  it('records an admin edit in the audit log and keeps a developer out', async () => {
    await db.insertInto('scholar').values({ id: 4242, name_en: 'Audit Subject', category: 'companion', death_place: 'Makkah', quality_flags: [], extra: {} })
      .onConflict(oc => oc.column('id').doUpdateSet({ name_en: 'Audit Subject', death_place: 'Makkah' }))
      .execute();
    await db.insertInto('scholar').values({ id: 4243, name_en: 'Audit Teacher', category: 'companion', quality_flags: [], extra: {} })
      .onConflict(oc => oc.column('id').doNothing())
      .execute();
    await db.deleteFrom('scholar_relation').where('subject_id', '=', 4242).execute();

    const session = await signIn('admin');
    const page = await app.inject({ url: '/admin/scholars/4242', headers: { cookie: session } });
    expect(page.statusCode).toBe(200);
    const csrf = page.body.match(/name="csrf" value="([^"]+)"/)?.[1] ?? '';
    const saved = await app.inject({
      method: 'POST',
      url: '/admin/scholars/4242',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        csrf, name_en: 'Audit Subject', name_ar: '', famous_name: '', category: 'companion',
        tabaqa: '', madhhab: '', grade: '', birth_year_ah: '', death_year_ah: '',
        death_place: 'Medina', death_cause: '', bio_text: '',
      }).toString(),
    });
    expect(saved.statusCode).toBe(303);
    const audit = await db.selectFrom('audit_log').select(['field', 'entity_id'])
      .where('entity', '=', 'scholar').where('entity_id', '=', '4242').where('field', '=', 'death_place')
      .executeTakeFirst();
    expect(audit).toBeTruthy();

    const added = await app.inject({
      method: 'POST',
      url: '/admin/scholars/4242/relations',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ csrf, type: 'teacher', object_id: '4243', object_name: 'Audit Teacher' }).toString(),
    });
    expect(added.statusCode).toBe(303);
    const teachers = await app.inject({ url: '/v1/scholars/4242/teachers', headers: { 'x-api-key': TRY_IT_TOKEN, 'x-forwarded-for': '203.0.113.20' } });
    expect(teachers.json().data.map((row: { id: number }) => row.id)).toContain(4243);

    const developer = await signIn('dev');
    const forbidden = await app.inject({ url: '/admin', headers: { cookie: developer } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('leaves portal and admin out of the public OpenAPI document', async () => {
    const spec = await app.inject('/openapi.json');
    const paths = Object.keys(spec.json().paths as Record<string, unknown>);
    expect(paths.some(path => path.startsWith('/portal') || path.startsWith('/admin'))).toBe(false);
    expect(spec.json().info.description).toContain(TRY_IT_TOKEN);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/scholars' } as InjectOptions);
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
  });
});
