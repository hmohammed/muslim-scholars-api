import type { FastifyInstance } from 'fastify';
import { Type } from '@fastify/type-provider-typebox';
import { normalizeAr, type Database } from '@msapi/db';
import { sql, type Kysely, type SelectQueryBuilder } from 'kysely';
import { ATTRIBUTION, scholarSourceUrl } from '../attribution.ts';
import { network, teacherChains } from '../graph.ts';
import { decodeCursor, encodeCursor, problem } from '../http.ts';

const CATEGORIES = new Set([
  'prophet', 'companion', 'follower', 'successor', 'relative',
  'century_3', 'century_4', 'century_5', 'century_6', 'century_7',
  'century_8', 'century_9', 'century_10', 'century_11', 'century_12',
  'century_13', 'century_14', 'century_15',
]);

const Name = Type.Object({ en: Type.String(), ar: Type.Union([Type.String(), Type.Null()]) });
const Summary = Type.Object({
  id: Type.Integer(),
  name: Name,
  category: Type.String(),
  tabaqa: Type.Union([Type.Integer(), Type.Null()]),
  madhhab: Type.Union([Type.String(), Type.Null()]),
  grade: Type.Union([Type.String(), Type.Null()]),
  death_year_ah: Type.Union([Type.Integer(), Type.Null()]),
  source_url: Type.String(),
});

function envelope(data: unknown) {
  return { data, meta: {}, attribution: ATTRIBUTION };
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

function applyFilters<T>(query: SelectQueryBuilder<Database, 'scholar', T>, input: Record<string, unknown>): SelectQueryBuilder<Database, 'scholar', T> {
  let next = query;
  const q = typeof input.q === 'string' ? normalizeAr(input.q) : '';
  if (q) {
    const prefix = likePrefix(q);
    next = next.where(sql<boolean>`(
      search_name = ${q} OR search_name LIKE ${prefix} ESCAPE '\\'
      OR (${q.length >= 3} AND (search_name % ${q} OR ${q} <% search_name))
      OR EXISTS (
        SELECT 1 FROM name_variant
        WHERE name_variant.scholar_id = scholar.id
          AND (name_norm = ${q} OR name_norm LIKE ${prefix} ESCAPE '\\' OR (${q.length >= 3} AND (name_norm % ${q} OR ${q} <% name_norm)))
      ))`);
  }
  if (typeof input.text === 'string' && input.text.trim()) {
    const text = input.text.trim();
    next = next.where(sql<boolean>`(
      bio_tsv @@ plainto_tsquery('simple', ${text})
      OR EXISTS (
        SELECT 1 FROM source_entry
        WHERE source_entry.scholar_id = scholar.id
          AND text_tsv @@ plainto_tsquery('simple', ${text})
      ))`);
  }
  if (typeof input.category === 'string') {
    if (!CATEGORIES.has(input.category)) throw problem(400, `Unknown category ${input.category}`);
    next = next.where('category', '=', input.category as never);
  }
  if (typeof input.tabaqa === 'number') next = next.where('tabaqa', '=', input.tabaqa);
  if (typeof input.madhhab === 'string') next = next.where('madhhab', '=', input.madhhab as never);
  if (typeof input.grade === 'string') next = next.where('grade', '=', input.grade as never);
  if (typeof input.death_from === 'number') next = next.where('death_year_ah', '>=', input.death_from);
  if (typeof input.death_to === 'number') next = next.where('death_year_ah', '<=', input.death_to);
  if (input.has_bio === true) next = next.where('bio_text', 'is not', null);
  if (input.has_bio === false) next = next.where('bio_text', 'is', null);
  if (input.has_tk === true) next = next.where(sql<boolean>`exists (select 1 from tk_entry where tk_entry.scholar_id = scholar.id)`);
  if (input.has_tk === false) next = next.where(sql<boolean>`not exists (select 1 from tk_entry where tk_entry.scholar_id = scholar.id)`);
  if (typeof input.area === 'string') {
    next = next.where(sql<boolean>`exists (
      select 1 from scholar_area join area on area.id = scholar_area.area_id
      where scholar_area.scholar_id = scholar.id and area.name = ${input.area})`);
  }
  if (typeof input.tag === 'string') {
    next = next.where(sql<boolean>`exists (
      select 1 from scholar_tag join tag on tag.id = scholar_tag.tag_id
      where scholar_tag.scholar_id = scholar.id and tag.name = ${input.tag})`);
  }
  if (typeof input.place === 'string') {
    next = next.where(sql<boolean>`exists (
      select 1 from scholar_place join place on place.id = scholar_place.place_id
      where scholar_place.scholar_id = scholar.id and place.name_en = ${input.place})`);
  }
  return next;
}

const SUMMARY_COLUMNS = ['id', 'name_en', 'name_ar', 'category', 'tabaqa', 'madhhab', 'grade', 'death_year_ah', 'search_name'] as const;

function summaryOf(row: { id: number; name_en: string; name_ar: string | null; category: string; tabaqa: number | null; madhhab: string | null; grade: string | null; death_year_ah: number | null }) {
  return {
    id: row.id,
    name: { en: row.name_en, ar: row.name_ar },
    category: row.category,
    tabaqa: row.tabaqa,
    madhhab: row.madhhab,
    grade: row.grade,
    death_year_ah: row.death_year_ah,
    source_url: scholarSourceUrl(row.id),
  };
}

export async function registerV1(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get('/v1/scholars', {
    schema: {
      tags: ['scholars'],
      summary: 'List and filter scholars',
      querystring: Type.Object({
        q: Type.Optional(Type.String({ description: 'Name or variant, matched exactly, then by prefix, then by trigram similarity' })),
        text: Type.Optional(Type.String({ description: 'Search biographies and source texts' })),
        category: Type.Optional(Type.String()),
        tabaqa: Type.Optional(Type.Integer()),
        madhhab: Type.Optional(Type.String()),
        grade: Type.Optional(Type.String()),
        death_from: Type.Optional(Type.Integer()),
        death_to: Type.Optional(Type.Integer()),
        area: Type.Optional(Type.String()),
        tag: Type.Optional(Type.String()),
        place: Type.Optional(Type.String()),
        has_bio: Type.Optional(Type.Boolean()),
        has_tk: Type.Optional(Type.Boolean()),
        sort: Type.Optional(Type.Union([Type.Literal('id'), Type.Literal('name'), Type.Literal('death')])),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        cursor: Type.Optional(Type.String()),
      }),
      response: { 200: Type.Object({ data: Type.Array(Summary), meta: Type.Object({ next_cursor: Type.Optional(Type.String()) }), attribution: Type.Unknown() }) },
    },
  }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const limit = typeof query.limit === 'number' ? query.limit : 20;
    const sort = query.sort === 'name' || query.sort === 'death' ? query.sort : 'id';
    const cursor = typeof query.cursor === 'string' ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw problem(400, 'Invalid cursor');

    let rows = applyFilters(db.selectFrom('scholar').select(SUMMARY_COLUMNS), query);
    if (sort === 'id') {
      const after = typeof cursor?.id === 'number' ? cursor.id : null;
      if (after !== null) rows = rows.where('id', '>', after);
      rows = rows.orderBy('id');
    } else if (sort === 'name') {
      const afterName = typeof cursor?.name === 'string' ? cursor.name : null;
      const afterId = typeof cursor?.id === 'number' ? cursor.id : null;
      if (afterName !== null && afterId !== null) {
        rows = rows.where(sql<boolean>`(search_name, id) > (${afterName}, ${afterId})`);
      }
      rows = rows.orderBy('search_name').orderBy('id');
    } else {
      const afterYear = typeof cursor?.year === 'number' ? cursor.year : cursor?.year === null ? null : undefined;
      const afterId = typeof cursor?.id === 'number' ? cursor.id : null;
      if (afterId !== null && afterYear === null) rows = rows.where(sql<boolean>`death_year_ah is null and id > ${afterId}`);
      else if (afterId !== null && typeof afterYear === 'number') {
        rows = rows.where(sql<boolean>`(death_year_ah > ${afterYear} or (death_year_ah = ${afterYear} and id > ${afterId}) or death_year_ah is null)`);
      }
      rows = rows.orderBy(sql`death_year_ah asc nulls last`).orderBy('id');
    }
    const found = await rows.limit(limit + 1).execute();
    const page = found.slice(0, limit);
    const last = page.at(-1);
    let next: string | undefined;
    if (found.length > limit && last) {
      if (sort === 'name') next = encodeCursor({ name: last.search_name, id: last.id });
      else if (sort === 'death') next = encodeCursor({ year: last.death_year_ah, id: last.id });
      else next = encodeCursor({ id: last.id });
    }
    return { data: page.map(summaryOf), meta: next ? { next_cursor: next } : {}, attribution: ATTRIBUTION };
  });

  app.get('/v1/scholars/:id', {
    schema: {
      tags: ['scholars'],
      summary: 'Scholar detail',
      params: Type.Object({ id: Type.Integer() }),
      querystring: Type.Object({
        include: Type.Optional(Type.String({ description: 'Comma list: relations, sources, tk, rumuz, narrations, variants' })),
      }),
    },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const include = new Set(((request.query as { include?: string }).include ?? '').split(',').map(item => item.trim()).filter(Boolean));
    const row = await db.selectFrom('scholar').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw problem(404, `Scholar ${id} was not found`);
    const data: Record<string, unknown> = {
      ...summaryOf(row),
      honorific_ar: row.honorific_ar,
      short_name: row.short_name,
      famous_name: row.famous_name,
      full_name: row.full_name,
      birth: row.birth_raw || row.birth_year_ah !== null || row.birth_place ? {
        year_ah: row.birth_year_ah, year_ah_alt: row.birth_year_ah_alt, year_ce: row.birth_year_ce,
        qualifier: row.birth_qualifier, place: row.birth_place, date_note: row.birth_date_note, raw: row.birth_raw,
      } : null,
      death: row.death_raw || row.death_year_ah !== null || row.death_place ? {
        year_ah: row.death_year_ah, year_ah_alt: row.death_year_ah_alt, year_ce: row.death_year_ce,
        qualifier: row.death_qualifier, place: row.death_place, date_note: row.death_date_note,
        cause: row.death_cause, event: row.death_event, raw: row.death_raw,
      } : null,
      bio_text: row.bio_text,
      bio_lang: row.bio_lang,
      bio_link: row.bio_link,
      source_last_updated: row.source_last_updated,
      quality_flags: row.quality_flags,
      extra: row.extra,
    };
    if (include.has('relations')) {
      data.relations = await db.selectFrom('scholar_relation')
        .select(['type', 'object_id', 'object_name', 'position'])
        .where('subject_id', '=', id)
        .orderBy('type').orderBy('position')
        .execute();
    }
    if (include.has('sources')) {
      data.sources = await db.selectFrom('source_entry')
        .innerJoin('source_book', 'source_book.id', 'source_entry.book_id')
        .select(['source_entry.book_id', 'source_book.name_en', 'source_book.name_ar', 'source_entry.rid', 'source_entry.locator', 'source_entry.entry_type', 'source_entry.text_ar'])
        .where('scholar_id', '=', id)
        .orderBy('book_id')
        .execute();
    }
    if (include.has('tk')) data.tk = await db.selectFrom('tk_entry').selectAll().where('scholar_id', '=', id).executeTakeFirst() ?? null;
    if (include.has('rumuz')) {
      data.rumuz = await db.selectFrom('scholar_rumuz')
        .innerJoin('rumuz', 'rumuz.code', 'scholar_rumuz.code')
        .select(['rumuz.code', 'rumuz.meaning_en', 'rumuz.meaning_ar'])
        .where('scholar_id', '=', id)
        .execute();
    }
    if (include.has('narrations')) {
      data.narrations = await db.selectFrom('narration_count').select(['collection', 'count']).where('scholar_id', '=', id).execute();
    }
    if (include.has('variants')) {
      data.variants = await db.selectFrom('name_variant').select(['name_ar', 'origin']).where('scholar_id', '=', id).execute();
    }
    return envelope(data);
  });

  app.get('/v1/scholars/:id/relations', {
    schema: { tags: ['scholars'], summary: 'Relations as written on the page', params: Type.Object({ id: Type.Integer() }), querystring: Type.Object({ type: Type.Optional(Type.String()) }) },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const type = (request.query as { type?: string }).type;
    await requireScholar(db, id);
    let query = db.selectFrom('scholar_relation').select(['type', 'object_id', 'object_name', 'position']).where('subject_id', '=', id);
    if (type) query = query.where('type', '=', type as never);
    const rows = await query.orderBy('position').execute();
    return envelope(rows);
  });

  app.get('/v1/scholars/:id/teachers', {
    schema: { tags: ['graph'], summary: 'Teachers, combining both directions', params: Type.Object({ id: Type.Integer() }) },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const node = app.getGraph().nodes.get(id);
    if (!node) throw problem(404, `Scholar ${id} was not found`);
    return envelope(node.teachers.map(teacherId => person(app, teacherId)));
  });

  app.get('/v1/scholars/:id/students', {
    schema: { tags: ['graph'], summary: 'Students, combining both directions', params: Type.Object({ id: Type.Integer() }) },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const node = app.getGraph().nodes.get(id);
    if (!node) throw problem(404, `Scholar ${id} was not found`);
    return envelope(node.students.map(studentId => person(app, studentId)));
  });

  app.get('/v1/scholars/:id/network', {
    schema: {
      tags: ['graph'],
      summary: 'Nearby teachers and students',
      params: Type.Object({ id: Type.Integer() }),
      querystring: Type.Object({
        depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 3, default: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
      }),
    },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const query = request.query as { depth?: number; limit?: number };
    if (!app.getGraph().nodes.has(id)) throw problem(404, `Scholar ${id} was not found`);
    const result = network(app.getGraph(), id, query.depth ?? 1, query.limit ?? 50);
    return envelope({
      nodes: result.nodeIds.map(nodeId => person(app, nodeId)),
      edges: result.edges,
    });
  });

  app.get('/v1/scholars/:id/chain', {
    schema: {
      tags: ['graph'],
      summary: 'Shortest teacher chain to a scholar or to any Companion',
      params: Type.Object({ id: Type.Integer() }),
      querystring: Type.Object({
        to: Type.String({ description: 'companions, or a scholar id' }),
        max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 16 })),
      }),
    },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const query = request.query as { to: string; max_depth?: number };
    const graph = app.getGraph();
    if (!graph.nodes.has(id)) throw problem(404, `Scholar ${id} was not found`);
    const goal = query.to === 'companions'
      ? { kind: 'category' as const, category: 'companion' }
      : { kind: 'id' as const, id: Number(query.to) };
    if (goal.kind === 'id' && !Number.isInteger(goal.id)) throw problem(400, 'to must be companions or a scholar id');
    const started = performance.now();
    const paths = teacherChains(graph, id, goal, query.max_depth ?? 16);
    return {
      data: {
        from: id,
        to: query.to,
        elapsed_ms: Math.round(performance.now() - started),
        paths: paths.map(ids => ids.map(nodeId => person(app, nodeId))),
      },
      meta: {},
      attribution: ATTRIBUTION,
    };
  });

  app.get('/v1/scholars/:id/sources', {
    schema: { tags: ['scholars'], summary: 'Arabic source entries', params: Type.Object({ id: Type.Integer() }), querystring: Type.Object({ book: Type.Optional(Type.Integer()) }) },
  }, async (request) => {
    const { id } = request.params as { id: number };
    const book = (request.query as { book?: number }).book;
    await requireScholar(db, id);
    let query = db.selectFrom('source_entry')
      .innerJoin('source_book', 'source_book.id', 'source_entry.book_id')
      .select(['source_entry.book_id', 'source_book.name_en', 'source_book.name_ar', 'source_entry.rid', 'source_entry.locator', 'source_entry.entry_type', 'source_entry.text_ar'])
      .where('scholar_id', '=', id);
    if (typeof book === 'number') query = query.where('source_entry.book_id', '=', book);
    return envelope(await query.orderBy('book_id').execute());
  });

  app.get('/v1/search', {
    schema: {
      tags: ['search'],
      summary: 'Fuzzy name search',
      querystring: Type.Object({
        q: Type.String({ minLength: 1 }),
        lang: Type.Optional(Type.Union([Type.Literal('en'), Type.Literal('ar'), Type.Literal('any')])),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
        cursor: Type.Optional(Type.String()),
      }),
    },
  }, async (request) => {
    const query = request.query as { q: string; lang?: string; limit?: number; cursor?: string };
    const nq = normalizeAr(query.q);
    if (!nq) throw problem(400, 'q is empty after normalisation');
    const lang = query.lang === 'en' || query.lang === 'ar' ? query.lang : 'any';
    const prefix = likePrefix(nq);
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw problem(400, 'Invalid cursor');
    const rank = sql<number>`case
      when search_name = ${nq}
        or normalize_ar(name_en) = ${nq}
        or normalize_ar(coalesce(name_ar, '')) = ${nq}
        or normalize_ar(coalesce(short_name, '')) = ${nq}
        or normalize_ar(coalesce(famous_name, '')) = ${nq}
        or normalize_ar(coalesce(full_name, '')) = ${nq}
        or exists (select 1 from name_variant v where v.scholar_id = scholar.id and v.name_norm = ${nq}) then 0
      when search_name like ${prefix} escape '\\' or exists (select 1 from name_variant v where v.scholar_id = scholar.id and v.name_norm like ${prefix} escape '\\') then 1
      else 2 end`;
    const score = sql<number>`greatest(
      similarity(search_name, ${nq}),
      word_similarity(${nq}, search_name),
      coalesce((select max(greatest(similarity(name_norm, ${nq}), word_similarity(${nq}, name_norm))) from name_variant v where v.scholar_id = scholar.id), 0)
    )`;
    let rows = db.selectFrom('scholar')
      .select([...SUMMARY_COLUMNS, rank.as('rank'), score.as('score')])
      .where(sql<boolean>`(
        search_name = ${nq} or search_name like ${prefix} escape '\\'
        or (${nq.length >= 3} and (search_name % ${nq} or ${nq} <% search_name))
        or exists (
          select 1 from name_variant v
          where v.scholar_id = scholar.id
            and (v.name_norm = ${nq} or v.name_norm like ${prefix} escape '\\' or (${nq.length >= 3} and (v.name_norm % ${nq} or ${nq} <% v.name_norm)))
        ))`);
    if (lang === 'en') {
      rows = rows.where(sql<boolean>`(
        normalize_ar(name_en) = ${nq}
        or normalize_ar(name_en) like ${prefix} escape '\\'
        or (${nq.length >= 3} and (normalize_ar(name_en) % ${nq} or ${nq} <% normalize_ar(name_en))))`);
    } else if (lang === 'ar') {
      rows = rows.where(sql<boolean>`(
        (name_ar is not null and (
          normalize_ar(name_ar) = ${nq}
          or normalize_ar(name_ar) like ${prefix} escape '\\'
          or (${nq.length >= 3} and (normalize_ar(name_ar) % ${nq} or ${nq} <% normalize_ar(name_ar)))
        ))
        or exists (
          select 1 from name_variant v
          where v.scholar_id = scholar.id
            and (v.name_norm = ${nq} or v.name_norm like ${prefix} escape '\\' or (${nq.length >= 3} and (v.name_norm % ${nq} or ${nq} <% v.name_norm)))
        ))`);
    }
    if (cursor && typeof cursor.rank === 'number' && typeof cursor.score === 'number' && typeof cursor.id === 'number') {
      rows = rows.where(sql<boolean>`(
        (${rank}) > ${cursor.rank}
        or ((${rank}) = ${cursor.rank} and (${score}) < ${cursor.score})
        or ((${rank}) = ${cursor.rank} and (${score}) = ${cursor.score} and id > ${cursor.id}))`);
    }
    const found = await rows.orderBy(rank).orderBy(score, 'desc').orderBy('id').limit(limit + 1).execute();
    const page = found.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(row => ({ ...summaryOf(row), rank: row.rank, score: row.score })),
      meta: found.length > limit && last ? { next_cursor: encodeCursor({ rank: last.rank, score: last.score, id: last.id }) } : {},
      attribution: ATTRIBUTION,
    };
  });

  for (const lookup of [
    { path: '/v1/areas', table: 'area', link: 'scholar_area', name: 'name' },
    { path: '/v1/tags', table: 'tag', link: 'scholar_tag', name: 'name' },
    { path: '/v1/places', table: 'place', link: 'scholar_place', name: 'name_en' },
    { path: '/v1/books', table: 'source_book', link: 'source_entry', name: 'name_en' },
    { path: '/v1/rumuz', table: 'rumuz', link: 'scholar_rumuz', name: 'code' },
  ] as const) {
    app.get(lookup.path, {
      schema: { tags: ['lookups'], summary: `Lookup ${lookup.path.slice(4)}`, querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })) }) },
    }, async (request) => {
      const limit = (request.query as { limit?: number }).limit ?? 100;
      const idColumn = lookup.table === 'rumuz' ? 'code' : 'id';
      const result = await sql<{ id: number | string; name: string; count: number }>`
        select ${sql.ref(`${lookup.table}.${idColumn}`)} as id,
               ${sql.ref(`${lookup.table}.${lookup.name}`)} as name,
               count(${sql.ref(`${lookup.link}.${lookup.table === 'source_book' ? 'book_id' : lookup.table === 'rumuz' ? 'code' : lookup.table === 'area' ? 'area_id' : lookup.table === 'tag' ? 'tag_id' : 'place_id'}`)})::int as count
        from ${sql.table(lookup.table)}
        left join ${sql.table(lookup.link)} on ${sql.ref(`${lookup.link}.${lookup.table === 'source_book' ? 'book_id' : lookup.table === 'rumuz' ? 'code' : lookup.table === 'area' ? 'area_id' : lookup.table === 'tag' ? 'tag_id' : 'place_id'}`)} = ${sql.ref(`${lookup.table}.${idColumn}`)}
        group by 1, 2
        order by count desc, name
        limit ${limit}`.execute(db);
      return envelope(result.rows);
    });
  }

  app.get('/v1/stats', {
    schema: { tags: ['meta'], summary: 'Counts by category, grade and madhhab' },
  }, async () => {
    const [category, grade, madhhab] = await Promise.all([
      db.selectFrom('scholar').select(['category as key']).select(sql<number>`count(*)::int`.as('count')).groupBy('category').orderBy('count', 'desc').execute(),
      db.selectFrom('scholar').select(['grade as key']).select(sql<number>`count(*)::int`.as('count')).where('grade', 'is not', null).groupBy('grade').orderBy('count', 'desc').execute(),
      db.selectFrom('scholar').select(['madhhab as key']).select(sql<number>`count(*)::int`.as('count')).where('madhhab', 'is not', null).groupBy('madhhab').orderBy('count', 'desc').execute(),
    ]);
    return envelope({ category, grade, madhhab, scholars: category.reduce((sum, row) => sum + row.count, 0) });
  });

  app.get('/v1/meta', {
    schema: { tags: ['meta'], summary: 'Dataset version, import time and attribution' },
  }, async () => {
    const row = await db.selectFrom('scholar')
      .select(sql<number>`count(*)::int`.as('scholars'))
      .select(sql<Date | null>`max(updated_at)`.as('imported_at'))
      .executeTakeFirstOrThrow();
    return envelope({ scholars: row.scholars, imported_at: row.imported_at, attribution: ATTRIBUTION });
  });
}

function person(app: FastifyInstance, id: number) {
  const node = app.getGraph().nodes.get(id);
  return node
    ? { id: node.id, name: { en: node.nameEn, ar: node.nameAr }, category: node.category, source_url: scholarSourceUrl(id) }
    : { id, name: { en: String(id), ar: null }, category: null, source_url: scholarSourceUrl(id) };
}

async function requireScholar(db: Kysely<Database>, id: number): Promise<void> {
  const row = await db.selectFrom('scholar').select('id').where('id', '=', id).executeTakeFirst();
  if (!row) throw problem(404, `Scholar ${id} was not found`);
}
