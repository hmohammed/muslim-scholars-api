import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { DeathCause, Madhhab, RelationType, ScholarCategory, ScholarGrade } from '@msapi/db';
import { safeEqual } from '../auth/crypto.ts';
import { escapeHtml, page } from '../auth/html.ts';
import { signedIn, type SignedIn } from '../auth/session.ts';
import { problem } from '../http.ts';

const HIDE = { schema: { hide: true } };

const CATEGORIES: ScholarCategory[] = [
  'prophet', 'companion', 'follower', 'successor', 'relative',
  'century_3', 'century_4', 'century_5', 'century_6', 'century_7',
  'century_8', 'century_9', 'century_10', 'century_11', 'century_12',
  'century_13', 'century_14', 'century_15',
];
const SCHOOLS: Madhhab[] = ['hanafi', 'shafii', 'maliki', 'hanbali', 'other'];
const GRADES: ScholarGrade[] = [
  'Thiqah', 'Maqbool', 'Sadooq', 'Unknown-Majhool', 'Weak', 'Sadooq/Delusion',
  'Abandoned', 'No Doubt', 'Thiqah Thiqah', 'Not Thiqah', 'Undefined', 'Liar', 'Accused Liar',
];
const CAUSES: DeathCause[] = ['natural', 'killed', 'martyred', 'plague', 'poisoned'];
const RELATIONS: RelationType[] = ['teacher', 'student', 'parent', 'child', 'sibling', 'spouse'];

const FIELDS = ['name_en', 'name_ar', 'famous_name', 'category', 'tabaqa', 'madhhab', 'grade', 'birth_year_ah', 'death_year_ah', 'death_place', 'death_cause', 'bio_text'] as const;
type Field = typeof FIELDS[number];

function options(values: readonly string[], current: string | null): string {
  const blank = `<option value=""${current ? '' : ' selected'}>—</option>`;
  return blank + values.map(value => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

export async function registerAdmin(app: FastifyInstance): Promise<void> {
  async function admin(request: FastifyRequest, reply: FastifyReply): Promise<SignedIn | undefined> {
    const account = await signedIn(app.db, request, app.authConfig);
    if (!account) {
      const next = encodeURIComponent(request.url);
      reply.redirect(`/portal/login?next=${next}`);
      return undefined;
    }
    if (account.role !== 'admin') {
      reply.code(403).type('text/html').send(page('Admin', '<h1>Admin</h1><p class="error">This GitHub account is not an admin.</p>'));
      return undefined;
    }
    return account;
  }

  function checkCsrf(account: SignedIn, body: Record<string, unknown>): void {
    const token = typeof body.csrf === 'string' ? body.csrf : '';
    if (!safeEqual(account.csrf, token)) throw problem(403, 'Invalid form token');
  }

  app.get('/admin', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const audits = await app.db.selectFrom('audit_log')
      .select(['id', 'entity', 'entity_id', 'field', 'at'])
      .orderBy('id', 'desc')
      .limit(20)
      .execute();
    const rows = audits.map(row => `<tr><td>${escapeHtml(row.entity)} ${escapeHtml(row.entity_id)}</td><td>${escapeHtml(row.field)}</td><td>${escapeHtml(new Date(row.at).toISOString())}</td></tr>`).join('');
    return reply.type('text/html').send(page('Admin', `
      <h1>Admin</h1>
      <p>Signed in as ${escapeHtml(account.login)}.</p>
      <form method="get" action="/admin/scholar"><label>Scholar id <input name="id" required></label> <button>Open</button></form>
      <h2>Recent edits</h2>
      <table><thead><tr><th>Record</th><th>Field</th><th>When</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No edits yet.</td></tr>'}</tbody></table>
      <h2>Keys</h2>
      <p><a href="/admin/keys">Limits and accounts</a></p>`));
  });

  app.get('/admin/scholar', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const id = Number((request.query as { id?: string }).id);
    if (!Number.isInteger(id)) return reply.redirect('/admin');
    return reply.redirect(`/admin/scholars/${id}`);
  });

  app.get('/admin/scholars/:id', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const id = Number((request.params as { id: string }).id);
    const scholar = await app.db.selectFrom('scholar').select(FIELDS).where('id', '=', id).executeTakeFirst();
    if (!scholar) return reply.code(404).type('text/html').send(page('Scholar', '<p>Scholar not found.</p>'));
    const relations = await app.db.selectFrom('scholar_relation')
      .select(['id', 'type', 'object_id', 'object_name'])
      .where('subject_id', '=', id)
      .orderBy('type')
      .orderBy('position')
      .limit(200)
      .execute();
    const csrf = escapeHtml(account.csrf);
    const relationRows = relations.map(relation => `<tr><td>${escapeHtml(relation.type)}</td><td>${relation.object_id ?? ''}</td><td>${escapeHtml(relation.object_name)}</td>
      <td><form class="inline" method="post" action="/admin/relations/${relation.id}/delete"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="scholar_id" value="${id}"><button>Remove</button></form></td></tr>`).join('');
    return reply.type('text/html').send(page(scholar.name_en, `
      <h1>${escapeHtml(scholar.name_en)}</h1>
      <p><a href="/admin">Back</a></p>
      <form method="post" action="/admin/scholars/${id}">
        <input type="hidden" name="csrf" value="${csrf}">
        <p><label>English name <input name="name_en" value="${escapeHtml(scholar.name_en)}" required></label></p>
        <p><label>Arabic name <input name="name_ar" value="${escapeHtml(scholar.name_ar ?? '')}"></label></p>
        <p><label>Famous name <input name="famous_name" value="${escapeHtml(scholar.famous_name ?? '')}"></label></p>
        <p><label>Category <select name="category">${options(CATEGORIES, scholar.category)}</select></label></p>
        <p><label>Tabaqa <input name="tabaqa" value="${scholar.tabaqa ?? ''}"></label></p>
        <p><label>Madhhab <select name="madhhab">${options(SCHOOLS, scholar.madhhab)}</select></label></p>
        <p><label>Grade <select name="grade">${options(GRADES, scholar.grade)}</select></label></p>
        <p><label>Birth AH <input name="birth_year_ah" value="${scholar.birth_year_ah ?? ''}"></label>
           <label>Death AH <input name="death_year_ah" value="${scholar.death_year_ah ?? ''}"></label></p>
        <p><label>Death place <input name="death_place" value="${escapeHtml(scholar.death_place ?? '')}"></label>
           <label>Cause <select name="death_cause">${options(CAUSES, scholar.death_cause)}</select></label></p>
        <p><label>Biography<br><textarea name="bio_text">${escapeHtml(scholar.bio_text ?? '')}</textarea></label></p>
        <button>Save</button>
      </form>
      <h2>Relations</h2>
      <table><tbody>${relationRows || '<tr><td>None.</td></tr>'}</tbody></table>
      <form method="post" action="/admin/scholars/${id}/relations">
        <input type="hidden" name="csrf" value="${csrf}">
        <select name="type">${RELATIONS.map(type => `<option>${escapeHtml(type)}</option>`).join('')}</select>
        <input name="object_id" placeholder="id">
        <input name="object_name" placeholder="name" required>
        <button>Add</button>
      </form>`));
  });

  app.post('/admin/scholars/:id', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const body = request.body as Record<string, unknown>;
    checkCsrf(account, body);
    const id = Number((request.params as { id: string }).id);
    const current = await app.db.selectFrom('scholar').select(FIELDS).where('id', '=', id).executeTakeFirst();
    if (!current) throw problem(404, 'Scholar not found');
    const patch = patchOf(current, body);
    if (Object.keys(patch).length) {
      await app.db.transaction().execute(async trx => {
        for (const [field, value] of Object.entries(patch)) {
          await trx.insertInto('audit_log').values({
            account_id: account.id,
            entity: 'scholar',
            entity_id: String(id),
            field,
            old: jsonValue(current[field as Field]),
            new: jsonValue(value),
          }).execute();
        }
        await trx.updateTable('scholar').set({ ...patch, updated_at: sql`now()` } as never).where('id', '=', id).execute();
      });
      await app.reloadGraph();
    }
    return reply.code(303).redirect(`/admin/scholars/${id}`);
  });

  app.post('/admin/scholars/:id/relations', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const body = request.body as Record<string, unknown>;
    checkCsrf(account, body);
    const id = Number((request.params as { id: string }).id);
    const type = typeof body.type === 'string' && RELATIONS.includes(body.type as RelationType) ? body.type as RelationType : null;
    const objectName = typeof body.object_name === 'string' ? body.object_name.trim().slice(0, 300) : '';
    const objectId = typeof body.object_id === 'string' && body.object_id.trim() ? Number(body.object_id) : null;
    if (!type || !objectName || (objectId !== null && !Number.isInteger(objectId))) throw problem(400, 'Relation needs a type and a name');
    const position = await app.db.selectFrom('scholar_relation')
      .select(sql<number>`coalesce(max(position), 0)::int`.as('max'))
      .where('subject_id', '=', id)
      .where('type', '=', type)
      .executeTakeFirstOrThrow();
    try {
      await app.db.transaction().execute(async trx => {
        await trx.insertInto('scholar_relation').values({
          subject_id: id,
          type,
          object_id: objectId,
          object_name: objectName,
          position: Number(position.max ?? 0) + 1,
        }).execute();
        await trx.insertInto('audit_log').values({
          account_id: account.id,
          entity: 'scholar_relation',
          entity_id: String(id),
          field: type,
          old: null,
          new: JSON.stringify({ object_id: objectId, object_name: objectName }),
        }).execute();
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw problem(400, 'That relation is already recorded');
      throw error;
    }
    await sql`REFRESH MATERIALIZED VIEW teaching_edge`.execute(app.db);
    await app.reloadGraph();
    return reply.code(303).redirect(`/admin/scholars/${id}`);
  });

  app.post('/admin/relations/:id/delete', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const body = request.body as Record<string, unknown>;
    checkCsrf(account, body);
    const relationId = Number((request.params as { id: string }).id);
    const scholarId = Number(body.scholar_id);
    const relation = await app.db.selectFrom('scholar_relation').select(['id', 'type', 'object_id', 'object_name'])
      .where('id', '=', relationId).where('subject_id', '=', scholarId).executeTakeFirst();
    if (relation) {
      await app.db.transaction().execute(async trx => {
        await trx.deleteFrom('scholar_relation').where('id', '=', relationId).execute();
        await trx.insertInto('audit_log').values({
          account_id: account.id,
          entity: 'scholar_relation',
          entity_id: String(scholarId),
          field: relation.type,
          old: JSON.stringify({ object_id: relation.object_id, object_name: relation.object_name }),
          new: null,
        }).execute();
      });
      await sql`REFRESH MATERIALIZED VIEW teaching_edge`.execute(app.db);
      await app.reloadGraph();
    }
    return reply.code(303).redirect(`/admin/scholars/${scholarId}`);
  });

  app.get('/admin/keys', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const keys = await app.db.selectFrom('api_key')
      .innerJoin('account', 'account.id', 'api_key.account_id')
      .select(['api_key.id', 'api_key.name', 'api_key.prefix', 'api_key.per_day', 'api_key.per_second', 'api_key.revoked_at', 'account.id as account_id', 'account.login', 'account.disabled_at'])
      .orderBy('api_key.id', 'desc')
      .limit(100)
      .execute();
    const csrf = escapeHtml(account.csrf);
    const rows = keys.map(key => `<tr>
      <td>${escapeHtml(key.login)}${key.disabled_at ? ' (disabled)' : ''}<br><code>${escapeHtml(key.prefix)}</code> ${escapeHtml(key.name)}</td>
      <td><form method="post" action="/admin/keys/${key.id}/limits"><input type="hidden" name="csrf" value="${csrf}">
        <input name="per_day" value="${key.per_day}" size="6"> /day
        <input name="per_second" value="${key.per_second}" size="3"> /s
        <button>Save</button></form></td>
      <td>${key.revoked_at ? 'Revoked' : 'Active'}</td>
      <td><form method="post" action="/admin/accounts/${key.account_id}/${key.disabled_at ? 'enable' : 'disable'}"><input type="hidden" name="csrf" value="${csrf}"><button>${key.disabled_at ? 'Enable' : 'Disable'}</button></form></td>
    </tr>`).join('');
    return reply.type('text/html').send(page('Keys', `<h1>Keys</h1><p><a href="/admin">Back</a></p><table><tbody>${rows}</tbody></table>`));
  });

  app.post('/admin/keys/:id/limits', HIDE, async (request, reply) => {
    const account = await admin(request, reply);
    if (!account) return reply;
    const body = request.body as Record<string, unknown>;
    checkCsrf(account, body);
    const id = Number((request.params as { id: string }).id);
    const perDay = Number(body.per_day);
    const perSecond = Number(body.per_second);
    if (!Number.isInteger(perDay) || !Number.isInteger(perSecond) || perDay < 1 || perSecond < 1 || perDay > 1_000_000 || perSecond > 100) {
      throw problem(400, 'Limits must be positive integers');
    }
    const current = await app.db.selectFrom('api_key').select(['per_day', 'per_second']).where('id', '=', id).executeTakeFirst();
    if (current) {
      await app.db.transaction().execute(async trx => {
        await trx.updateTable('api_key').set({ per_day: perDay, per_second: perSecond, updated_at: new Date() }).where('id', '=', id).execute();
        await trx.insertInto('audit_log').values({
          account_id: account.id,
          entity: 'api_key',
          entity_id: String(id),
          field: 'limits',
          old: JSON.stringify(current),
          new: JSON.stringify({ per_day: perDay, per_second: perSecond }),
        }).execute();
      });
    }
    return reply.code(303).redirect('/admin/keys');
  });

  for (const action of ['disable', 'enable'] as const) {
    app.post(`/admin/accounts/:id/${action}`, HIDE, async (request, reply) => {
      const account = await admin(request, reply);
      if (!account) return reply;
      checkCsrf(account, request.body as Record<string, unknown>);
      const id = Number((request.params as { id: string }).id);
      if (id === account.id && action === 'disable') throw problem(400, 'You cannot disable your own account');
      await app.db.updateTable('account').set({
        disabled_at: action === 'disable' ? new Date() : null,
        updated_at: new Date(),
      }).where('id', '=', id).execute();
      await app.db.insertInto('audit_log').values({
        account_id: account.id,
        entity: 'account',
        entity_id: String(id),
        field: 'disabled_at',
        old: null,
        new: JSON.stringify(action),
      }).execute();
      return reply.code(303).redirect('/admin/keys');
    });
  }
}

function jsonValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return JSON.stringify(value);
}

function patchOf(current: Record<Field, unknown>, body: Record<string, unknown>): Partial<Record<Field, unknown>> {
  const patch: Partial<Record<Field, unknown>> = {};
  const name = text(body.name_en);
  if (!name) throw problem(400, 'English name is required');
  assign(patch, current, 'name_en', name);
  assign(patch, current, 'name_ar', text(body.name_ar) || null);
  assign(patch, current, 'famous_name', text(body.famous_name) || null);
  const category = text(body.category);
  if (!CATEGORIES.includes(category as ScholarCategory)) throw problem(400, 'Unknown category');
  assign(patch, current, 'category', category);
  assign(patch, current, 'tabaqa', optionalInt(body.tabaqa, 'tabaqa'));
  const school = text(body.madhhab);
  if (school && !SCHOOLS.includes(school as Madhhab)) throw problem(400, 'Unknown madhhab');
  assign(patch, current, 'madhhab', school || null);
  const grade = text(body.grade);
  if (grade && !GRADES.includes(grade as ScholarGrade)) throw problem(400, 'Unknown grade');
  assign(patch, current, 'grade', grade || null);
  assign(patch, current, 'birth_year_ah', optionalInt(body.birth_year_ah, 'birth year'));
  assign(patch, current, 'death_year_ah', optionalInt(body.death_year_ah, 'death year'));
  assign(patch, current, 'death_place', text(body.death_place) || null);
  const cause = text(body.death_cause);
  if (cause && !CAUSES.includes(cause as DeathCause)) throw problem(400, 'Unknown cause');
  assign(patch, current, 'death_cause', cause || null);
  assign(patch, current, 'bio_text', text(body.bio_text) || null);
  return patch;
}

function assign(patch: Partial<Record<Field, unknown>>, current: Record<Field, unknown>, field: Field, value: unknown): void {
  const before = current[field] ?? null;
  const after = value ?? null;
  if (before !== after) patch[field] = after;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalInt(value: unknown, label: string): number | null {
  const raw = text(value);
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isInteger(number)) throw problem(400, `${label} must be an integer`);
  return number;
}
