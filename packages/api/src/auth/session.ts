import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '@msapi/db';
import type { AuthConfig } from './config.ts';
import { open, randomToken, seal } from './crypto.ts';

export const SESSION_COOKIE = 'msapi_session';
export const OAUTH_COOKIE = 'msapi_oauth';
const SESSION_AGE = 60 * 60 * 24 * 14;

export interface Session {
  accountId: number;
  csrf: string;
  exp: number;
}

export interface OauthState {
  state: string;
  next: string;
  exp: number;
}

export interface SignedIn {
  id: number;
  login: string;
  role: 'developer' | 'admin';
  csrf: string;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function writeCookie(reply: FastifyReply, name: string, value: string, maxAge: number, path = '/'): void {
  reply.header('set-cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`);
}

export function clearCookie(reply: FastifyReply, name: string, path = '/'): void {
  writeCookie(reply, name, '', 0, path);
}

export function readSession(request: FastifyRequest, sessionKey: string): Session | null {
  if (!sessionKey) return null;
  const raw = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!raw) return null;
  const session = open<Session>(raw, sessionKey);
  if (!session || session.exp < Date.now() || !session.accountId || !session.csrf) return null;
  return session;
}

export function startSession(reply: FastifyReply, sessionKey: string, accountId: number): string {
  const csrf = randomToken(24);
  writeCookie(reply, SESSION_COOKIE, seal({ accountId, csrf, exp: Date.now() + SESSION_AGE * 1000 }, sessionKey), SESSION_AGE);
  return csrf;
}

export async function signedIn(db: Kysely<Database>, request: FastifyRequest, config: AuthConfig): Promise<SignedIn | null> {
  const session = readSession(request, config.sessionKey);
  if (!session) return null;
  const account = await db.selectFrom('account').select(['id', 'login', 'role', 'disabled_at']).where('id', '=', session.accountId).executeTakeFirst();
  if (!account || account.disabled_at) return null;
  return { id: Number(account.id), login: account.login, role: account.role, csrf: session.csrf };
}

export function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/portal';
  if (value.startsWith('/portal') || value.startsWith('/admin')) return value;
  return '/portal';
}
