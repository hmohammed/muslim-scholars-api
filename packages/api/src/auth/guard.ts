import type { FastifyRequest } from 'fastify';
import type { AuthConfig } from './config.ts';
import { findKey, TRY_IT_PREFIX } from './keys.ts';
import { problem } from '../http.ts';
import type { UsageMeter } from './usage.ts';
import type { Kysely } from 'kysely';
import type { Database } from '@msapi/db';

export async function requireApiKey(
  db: Kysely<Database>,
  usage: UsageMeter,
  config: AuthConfig,
  request: FastifyRequest,
): Promise<void> {
  const header = request.headers['x-api-key'];
  const presented = Array.isArray(header) ? header[0] : header;
  if (!presented) throw problem(401, 'Missing X-API-Key header');
  const key = await findKey(db, presented, config.pepper);
  if (!key || key.revoked) throw problem(401, 'API key was not recognized');
  if (key.accountDisabled) throw problem(401, 'This account is disabled');
  const scope = key.prefix === TRY_IT_PREFIX ? `ip:${request.ip}` : 'key';
  const decision = await usage.charge(key.id, scope, key.perDay, key.perSecond);
  if (decision === 'second') throw problem(429, 'Too many requests in one second for this key');
  if (decision === 'daily') throw problem(429, 'Daily request quota is used up');
  request.log = request.log.child({ apiKeyId: key.id });
}
