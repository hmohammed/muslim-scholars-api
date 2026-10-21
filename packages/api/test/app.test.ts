import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDb, migrate } from '@msapi/db';
import { buildApp } from '../src/app.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://msapi:msapi@localhost:5433/msapi_test';
const db = createDb(url);
let app: FastifyInstance;

beforeAll(async () => {
  await migrate(url);
  app = await buildApp({ db, logLevel: 'silent' });
});

afterAll(async () => {
  await app?.close();
  await db.destroy();
});

describe('meta routes', () => {
  it('reports healthy when the database answers', async () => {
    const res = await app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('serves a valid OpenAPI 3.1 document that includes /healthz', async () => {
    const res = await app.inject('/openapi.json');
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths).toHaveProperty('/healthz');
  });

  it('serves Swagger UI', async () => {
    const res = await app.inject('/docs/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
