import type pg from 'pg';

/** Local Docker and Railway's private network speak plain Postgres. Public hosts need TLS. */
export function pgConfig(connectionString: string): pg.ClientConfig {
  let host = '';
  try {
    host = new URL(connectionString.replace(/^postgres(?:ql)?:/i, 'http:')).hostname;
  } catch {
    host = '';
  }
  const privateHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.internal');
  return { connectionString, ssl: privateHost ? undefined : { rejectUnauthorized: false } };
}
