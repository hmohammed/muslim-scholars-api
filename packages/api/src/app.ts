import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@msapi/db';
import { resolveAuth, type AuthConfig } from './auth/config.ts';
import { requireApiKey } from './auth/guard.ts';
import { seedTryItKey, TRY_IT_TOKEN } from './auth/keys.ts';
import { UsageMeter } from './auth/usage.ts';
import { attributionHtml } from './attribution.ts';
import { loadGraph, type ScholarGraph } from './graph.ts';
import { registerErrors } from './http.ts';
import { registerAdmin } from './routes/admin.ts';
import { registerPortal } from './routes/portal.ts';
import { registerV1 } from './routes/v1.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>;
    authConfig: AuthConfig;
    getGraph: () => ScholarGraph;
    reloadGraph: () => Promise<void>;
    flushUsage: () => Promise<void>;
  }
}

export interface AppOptions {
  db: Kysely<Database>;
  logLevel?: string;
  auth?: Partial<AuthConfig>;
}

export async function buildApp({ db, logLevel = 'info', auth: authInput }: AppOptions): Promise<FastifyInstance> {
  const auth = resolveAuth(authInput);
  const usage = new UsageMeter(db);
  const app = Fastify({
    trustProxy: true,
    logger: { level: logLevel, redact: ['req.headers["x-api-key"]', 'req.headers.cookie'] },
    ajv: { customOptions: { coerceTypes: true } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.decorate('authConfig', auth);
  app.decorate('flushUsage', () => usage.flush());
  let graph = await loadGraph(db);
  app.decorate('getGraph', () => graph);
  app.decorate('reloadGraph', async () => {
    graph = await loadGraph(db);
  });
  app.addHook('onClose', async () => { usage.stop(); });
  registerErrors(app);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/v1')) return;
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-allow-headers', 'X-API-Key, Content-Type');
    reply.header('access-control-allow-methods', 'GET, OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
    await requireApiKey(db, usage, auth, request);
  });

  app.get('/docs/attribution', async (_request, reply) => {
    return reply.type('text/html').send(await attributionHtml());
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Muslim Scholars API',
        version: '0.1.0',
        description: 'Biographies, teacher–student networks and classical source texts for ~25,000 Muslim scholars. ' +
          'Data originally compiled by the Muslim Scholars Database (Arees Institute). ' +
          `Send the X-API-Key header. The shared Try it key is ${TRY_IT_TOKEN} (100 requests per day and 2 per second for each IP). Create your own key at /portal.`,
      },
      components: {
        securitySchemes: {
          ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
      security: [{ ApiKey: [] }],
      tags: [
        { name: 'scholars', description: 'Records and the relations written on each page' },
        { name: 'graph', description: 'Teacher and student links combined from both directions' },
        { name: 'search', description: 'Fuzzy name search' },
        { name: 'lookups', description: 'Areas, tags, places, books and rumuz' },
        { name: 'meta', description: 'Health, dataset and statistics' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { persistAuthorization: true } });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  app.get('/healthz', {
    schema: {
      summary: 'Service health',
      tags: ['meta'],
      security: [],
      response: { 200: Type.Object({ status: Type.Literal('ok'), db: Type.Literal('ok') }) },
    },
  }, async () => {
    await sql`select 1`.execute(db);
    return { status: 'ok' as const, db: 'ok' as const };
  });

  await registerV1(app);
  await registerPortal(app);
  await registerAdmin(app);
  await seedTryItKey(db, auth.pepper);
  return app;
}
