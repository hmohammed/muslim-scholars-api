import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { open, randomToken, safeEqual, seal } from '../auth/crypto.ts';
import { exchangeGitHubCode } from '../auth/github.ts';
import { escapeHtml, page } from '../auth/html.ts';
import { createKey } from '../auth/keys.ts';
import { clearCookie, OAUTH_COOKIE, readCookie, safeNext, SESSION_COOKIE, signedIn, startSession, writeCookie, type SignedIn } from '../auth/session.ts';
import { problem } from '../http.ts';

const HIDE = { schema: { hide: true } };
const ISSUED_MS = 5 * 60 * 1000;

interface Issued { accountId: number; token: string; expires: number }

const ERRORS: Record<string, string> = {
  disabled: 'This GitHub account is disabled.',
  github: 'GitHub sign-in failed. Try again.',
  state: 'Sign-in expired. Start again.',
  name: 'Give the key a short name.',
};

export async function registerPortal(app: FastifyInstance): Promise<void> {
  const issued = new Map<string, Issued>();
  const config = () => app.authConfig;

  async function viewer(request: FastifyRequest, reply: FastifyReply): Promise<SignedIn | undefined> {
    const account = await signedIn(app.db, request, config());
    if (!account) {
      reply.redirect('/portal/login');
      return undefined;
    }
    return account;
  }

  function checkCsrf(account: SignedIn, body: Record<string, unknown>): void {
    const token = typeof body.csrf === 'string' ? body.csrf : '';
    if (!safeEqual(account.csrf, token)) throw problem(403, 'Invalid form token');
  }

  app.get('/portal/login', HIDE, async (request, reply) => {
    const auth = config();
    if (!auth.githubClientId || !auth.githubClientSecret || !auth.sessionKey) {
      return reply.code(500).type('text/html').send(page('Sign in', '<p class="error">GitHub sign-in is not configured.</p>'));
    }
    const state = randomToken(24);
    const next = safeNext((request.query as { next?: string }).next);
    writeCookie(reply, OAUTH_COOKIE, seal({ state, next, exp: Date.now() + 10 * 60 * 1000 }, auth.sessionKey), 600, '/portal');
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', auth.githubClientId);
    url.searchParams.set('redirect_uri', `${auth.publicUrl}/portal/callback`);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/portal/callback', HIDE, async (request, reply) => {
    const auth = config();
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error || !query.code || !query.state) return reply.redirect('/portal?error=github');
    const raw = readCookie(request.headers.cookie, OAUTH_COOKIE);
    const saved = raw && auth.sessionKey ? open<{ state: string; next: string; exp: number }>(raw, auth.sessionKey) : null;
    clearCookie(reply, OAUTH_COOKIE, '/portal');
    if (!saved || saved.exp < Date.now() || !safeEqual(saved.state, query.state)) return reply.redirect('/portal?error=state');
    let profile;
    try {
      profile = await exchangeGitHubCode(auth, query.code);
    } catch (error) {
      request.log.warn({ err: error }, 'github sign-in failed');
      return reply.redirect('/portal?error=github');
    }
    const isAdmin = auth.adminLogins.includes(profile.login.toLowerCase());
    const account = await app.db.insertInto('account').values({
      github_id: profile.githubId,
      login: profile.login,
      email: profile.email,
      role: isAdmin ? 'admin' : 'developer',
    }).onConflict(oc => oc.column('github_id').doUpdateSet({
      login: profile.login,
      email: profile.email,
      updated_at: sql`now()`,
      ...(isAdmin ? { role: 'admin' as const } : {}),
    })).returning(['id', 'disabled_at']).executeTakeFirstOrThrow();
    if (account.disabled_at) return reply.redirect('/portal?error=disabled');
    startSession(reply, auth.sessionKey, Number(account.id));
    return reply.redirect(safeNext(saved.next));
  });

  app.get('/portal/logout', HIDE, async (_request, reply) => {
    clearCookie(reply, SESSION_COOKIE);
    return reply.redirect('/portal');
  });

  app.get('/portal', HIDE, async (request, reply) => {
    const account = await signedIn(app.db, request, config());
    const error = ERRORS[(request.query as { error?: string }).error ?? ''] ?? '';
    if (!account) {
      return reply.type('text/html').send(page('Portal', `
        <h1>Developer portal</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <p>Sign in with GitHub to create an API key. The key is shown once.</p>
        <p><a href="/portal/login">Sign in with GitHub</a></p>`));
    }
    const keys = await app.db.selectFrom('api_key')
      .leftJoin('usage_daily', join => join
        .onRef('usage_daily.api_key_id', '=', 'api_key.id')
        .on('usage_daily.day', '=', sql<Date>`current_date`))
      .select(['api_key.id', 'api_key.name', 'api_key.prefix', 'api_key.revoked_at', 'api_key.per_day', 'api_key.per_second', 'usage_daily.requests'])
      .where('api_key.account_id', '=', account.id)
      .orderBy('api_key.id', 'desc')
      .execute();
    const rows = keys.map(key => `<tr>
      <td>${escapeHtml(key.name)}<br><code>msk_live_${escapeHtml(key.prefix)}_…</code></td>
      <td>${key.requests ?? 0} / ${key.per_day}<br>${key.per_second}/s</td>
      <td>${key.revoked_at ? 'Revoked' : 'Active'}</td>
      <td>${key.revoked_at ? '' : `<form class="inline" method="post" action="/portal/keys/${key.id}/revoke"><input type="hidden" name="csrf" value="${escapeHtml(account.csrf)}"><button>Revoke</button></form>`}</td>
    </tr>`).join('');
    return reply.type('text/html').send(page('Portal', `
      <h1>Keys for ${escapeHtml(account.login)}</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <p>${account.role === 'admin' ? '<a href="/admin">Admin</a> · ' : ''}<a href="/portal/logout">Sign out</a></p>
      <form method="post" action="/portal/keys">
        <input type="hidden" name="csrf" value="${escapeHtml(account.csrf)}">
        <label>Name <input name="name" maxlength="80" required></label>
        <button>Create key</button>
      </form>
      <table><thead><tr><th>Key</th><th>Today</th><th></th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">No keys yet.</td></tr>'}</tbody></table>`));
  });

  app.post('/portal/keys', HIDE, async (request, reply) => {
    const account = await viewer(request, reply);
    if (!account) return reply;
    const body = request.body as Record<string, unknown>;
    checkCsrf(account, body);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) return reply.redirect('/portal?error=name');
    const created = await createKey(app.db, account.id, name, config().pepper);
    const ticket = randomToken(24);
    issued.set(ticket, { accountId: account.id, token: created.token, expires: Date.now() + ISSUED_MS });
    return reply.code(303).redirect(`/portal/issued/${ticket}`);
  });

  app.get('/portal/issued/:ticket', HIDE, async (request, reply) => {
    const account = await viewer(request, reply);
    if (!account) return reply;
    const ticket = (request.params as { ticket: string }).ticket;
    const saved = issued.get(ticket);
    issued.delete(ticket);
    if (!saved || saved.accountId !== account.id || saved.expires < Date.now()) {
      return reply.type('text/html').send(page('Key', '<h1>Key</h1><p>This key was already shown, or the link expired.</p><p><a href="/portal">Back to keys</a></p>'));
    }
    return reply.type('text/html').send(page('New key', `
      <h1>Copy this key now</h1>
      <p class="warn">This is the only time the full key is shown. Store it somewhere safe. Send it as the <code>X-API-Key</code> header.</p>
      <p><code>${escapeHtml(saved.token)}</code></p>
      <p><a href="/portal">Back to keys</a></p>`));
  });

  app.post('/portal/keys/:id/revoke', HIDE, async (request, reply) => {
    const account = await viewer(request, reply);
    if (!account) return reply;
    checkCsrf(account, request.body as Record<string, unknown>);
    const id = Number((request.params as { id: string }).id);
    await app.db.updateTable('api_key').set({ revoked_at: new Date(), updated_at: new Date() })
      .where('id', '=', id)
      .where('account_id', '=', account.id)
      .where('revoked_at', 'is', null)
      .execute();
    return reply.code(303).redirect('/portal');
  });
}
