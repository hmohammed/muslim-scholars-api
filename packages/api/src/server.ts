import { createDb, migrate } from '@msapi/db';
import { buildApp } from './app.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

await migrate(databaseUrl, message => console.log(message));
const db = createDb(databaseUrl);
const app = await buildApp({ db, logLevel: process.env.LOG_LEVEL });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}

await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
