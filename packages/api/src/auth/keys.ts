import type { Kysely } from 'kysely';
import type { Database } from '@msapi/db';
import { hashEquals, hashKey, randomToken } from './crypto.ts';

export const TRY_IT_PREFIX = 'docstry1';
export const TRY_IT_TOKEN = 'msk_live_docstry1_swaggertryitpublic';

const LIVE = 'msk_live_';

export function splitKey(header: string): { prefix: string; token: string } | null {
  const token = header.trim();
  if (!token.startsWith(LIVE)) return null;
  const rest = token.slice(LIVE.length);
  const split = rest.indexOf('_');
  if (split < 4) return null;
  return { prefix: rest.slice(0, split), token };
}

export async function createKey(
  db: Kysely<Database>,
  accountId: number,
  name: string,
  pepper: string,
  limits: { perDay?: number; perSecond?: number } = {},
): Promise<{ id: number; token: string; prefix: string }> {
  const prefix = randomToken(8);
  const token = `${LIVE}${prefix}_${randomToken(32)}`;
  const inserted = await db.insertInto('api_key').values({
    account_id: accountId,
    name,
    prefix,
    hash: hashKey(token, pepper),
    per_day: limits.perDay ?? 1000,
    per_second: limits.perSecond ?? 10,
  }).returning('id').executeTakeFirstOrThrow();
  return { id: Number(inserted.id), token, prefix };
}

export interface PresentedKey {
  id: number;
  prefix: string;
  perDay: number;
  perSecond: number;
  accountDisabled: boolean;
  revoked: boolean;
}

export async function findKey(db: Kysely<Database>, header: string, pepper: string): Promise<PresentedKey | null> {
  const parsed = splitKey(header);
  if (!parsed || !pepper) return null;
  const rows = await db.selectFrom('api_key')
    .innerJoin('account', 'account.id', 'api_key.account_id')
    .select(['api_key.id', 'api_key.prefix', 'api_key.hash', 'api_key.per_day', 'api_key.per_second', 'api_key.revoked_at', 'account.disabled_at'])
    .where('api_key.prefix', '=', parsed.prefix)
    .execute();
  const row = rows.find(candidate => hashEquals(candidate.hash, parsed.token, pepper));
  if (!row) return null;
  return {
    id: Number(row.id),
    prefix: row.prefix,
    perDay: row.per_day,
    perSecond: row.per_second,
    accountDisabled: row.disabled_at !== null,
    revoked: row.revoked_at !== null,
  };
}

export async function seedTryItKey(db: Kysely<Database>, pepper: string): Promise<void> {
  if (!pepper) return;
  await db.insertInto('account').values({ github_id: 0, login: 'docs', role: 'developer' })
    .onConflict(oc => oc.column('github_id').doNothing())
    .execute();
  const account = await db.selectFrom('account').select('id').where('github_id', '=', 0).executeTakeFirstOrThrow();
  const hash = hashKey(TRY_IT_TOKEN, pepper);
  const existing = await db.selectFrom('api_key').select('id').where('prefix', '=', TRY_IT_PREFIX).executeTakeFirst();
  if (existing) {
    await db.updateTable('api_key').set({
      hash,
      per_day: 100,
      per_second: 2,
      revoked_at: null,
      account_id: Number(account.id),
      updated_at: new Date(),
    }).where('id', '=', existing.id).execute();
    return;
  }
  await db.insertInto('api_key').values({
    account_id: Number(account.id),
    name: 'Docs try it',
    prefix: TRY_IT_PREFIX,
    hash,
    per_day: 100,
    per_second: 2,
  }).execute();
}
