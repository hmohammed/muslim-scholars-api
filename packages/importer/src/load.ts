import pg from 'pg';
import type { ParsedScholar } from './types.ts';

export type LoadMode = 'replace' | 'fill-empty';

const TRUNCATE = `
TRUNCATE TABLE
  scholar_relation, scholar_area, scholar_tag, scholar_place, scholar_rumuz,
  name_variant, narration_count, source_entry, scholar_msd_ref, tk_entry,
  scholar, area, tag, place, msd_reference
RESTART IDENTITY CASCADE`;

const SCHOLAR_COLUMNS = [
  'id', 'name_en', 'name_ar', 'honorific_ar', 'short_name', 'famous_name', 'full_name',
  'category', 'tabaqa', 'madhhab', 'grade', 'taqrib_verdict_ar',
  'birth_year_ah', 'birth_year_ah_alt', 'birth_year_ce', 'birth_qualifier', 'birth_place', 'birth_date_note', 'birth_raw',
  'death_year_ah', 'death_year_ah_alt', 'death_year_ce', 'death_qualifier', 'death_place', 'death_date_note', 'death_cause', 'death_event', 'death_raw',
  'bio_text', 'bio_lang', 'bio_link', 'source_last_updated', 'quality_flags', 'extra',
] as const;

function scholarRow(record: ParsedScholar): Record<string, unknown> {
  const date = (prefix: 'birth' | 'death', parsed: ParsedScholar['birth']) => ({
    [`${prefix}_year_ah`]: parsed?.yearAh ?? null,
    [`${prefix}_year_ah_alt`]: parsed?.yearAhAlt ?? null,
    [`${prefix}_year_ce`]: parsed?.yearCe ?? null,
    [`${prefix}_qualifier`]: parsed?.qualifier ?? null,
    [`${prefix}_place`]: parsed?.place ?? null,
    [`${prefix}_date_note`]: parsed?.dateNote ?? null,
    [`${prefix}_raw`]: parsed?.raw ?? null,
  });
  return {
    id: record.id,
    name_en: record.nameEn,
    name_ar: record.nameAr,
    honorific_ar: record.honorificAr,
    short_name: record.shortName,
    famous_name: record.famousName,
    full_name: record.fullName,
    category: record.category,
    tabaqa: record.tabaqa,
    madhhab: record.madhhab,
    grade: record.grade,
    taqrib_verdict_ar: record.taqribVerdictAr,
    ...date('birth', record.birth),
    ...date('death', record.death),
    death_cause: record.death?.cause ?? null,
    death_event: record.death?.event ?? null,
    bio_text: record.bioText,
    bio_lang: record.bioLang,
    bio_link: record.bioLink,
    source_last_updated: record.sourceLastUpdated,
    quality_flags: record.qualityFlags,
    extra: {
      ...(record.books.length ? { books: record.books } : {}),
      ...(Object.keys(record.sections).length ? { sections: record.sections } : {}),
      ...(record.gradeRaw ? { grade_raw: record.gradeRaw } : {}),
      ...(record.categoryNote ? { category_note: record.categoryNote } : {}),
    },
  };
}

async function insertRows(client: pg.Client, table: string, columns: readonly string[], rows: Record<string, unknown>[], conflict = ''): Promise<void> {
  const size = table === 'source_entry' ? 100 : 400;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')})
       SELECT ${columns.join(', ')}
       FROM json_populate_recordset(NULL::${table}, $1::json)
       ${conflict}`,
      [JSON.stringify(slice)],
    );
  }
}

async function idMap(client: pg.Client, table: string, key: string, rows: Record<string, unknown>[], extraUpdate = ''): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!rows.length) return map;
  const columns = Object.keys(rows[0] ?? {});
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    const result = await client.query<{ key: string; id: number }>(
      `INSERT INTO ${table} (${columns.join(', ')})
       SELECT ${columns.join(', ')}
       FROM json_to_recordset($1::json) AS x(${columns.map(column => `${column} ${column === 'kind' ? 'tag_kind' : 'text'}`).join(', ')})
       ON CONFLICT (${key}) DO UPDATE SET ${extraUpdate || `${key} = EXCLUDED.${key}`}
       RETURNING ${key} AS key, id`,
      [JSON.stringify(slice)],
    );
    for (const row of result.rows) map.set(row.key, row.id);
  }
  return map;
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function loadRecords(connectionString: string, records: ParsedScholar[], mode: LoadMode = 'replace'): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (mode === 'replace') await client.query(TRUNCATE);

    const areas = [...new Set(records.flatMap(record => record.areas))].map(name => ({ name }));
    const tags = dedupe(records.flatMap(record => record.tags), tag => tag.name).map(tag => ({ name: tag.name, kind: tag.kind }));
    const places = [...new Set(records.flatMap(record => [
      ...record.places,
      record.birth?.place,
      record.death?.place,
    ].flatMap(place => place ? place.split('/').map(part => part.trim()).filter(Boolean) : [])))].map(name => ({ name_en: name }));
    const codes = [...new Set(records.flatMap(record => record.rumuz))].map(code => ({ code }));
    const refs = dedupe(records.flatMap(record => record.msdRefs), ref => String(ref.refNo)).map(ref => ({ ref_no: ref.refNo }));
    const books = new Map<number, { id: number; name_en: string; name_ar: string | null }>();
    for (const record of records) {
      for (const source of record.sources) {
        const current = books.get(source.bookId);
        const name = source.bookName && source.bookName.length > (current?.name_en.length ?? 0) ? source.bookName : current?.name_en;
        if (!current || name) books.set(source.bookId, { id: source.bookId, name_en: name || current?.name_en || `Book ${source.bookId}`, name_ar: source.bookNameAr ?? current?.name_ar ?? null });
      }
    }

    const areaIds = await idMap(client, 'area', 'name', areas, 'updated_at = area.updated_at');
    const tagIds = await idMap(client, 'tag', 'name', tags, 'kind = EXCLUDED.kind, updated_at = tag.updated_at');
    const placeIds = await idMap(client, 'place', 'name_en', places, 'updated_at = place.updated_at');
    if (codes.length) {
      await insertRows(client, 'rumuz', ['code'], codes.map(code => ({ code: code.code })), 'ON CONFLICT (code) DO NOTHING');
    }
    if (refs.length) {
      await client.query(
        `INSERT INTO msd_reference (ref_no)
         SELECT ref_no FROM json_to_recordset($1::json) AS x(ref_no int)
         ON CONFLICT (ref_no) DO NOTHING`,
        [JSON.stringify(refs)],
      );
    }
    const bookRows = [...books.values()].filter(book => book.id > 0);
    if (bookRows.length) {
      await client.query(
        `INSERT INTO source_book (id, name_en, name_ar)
         SELECT id, name_en, name_ar FROM json_to_recordset($1::json) AS x(id int, name_en text, name_ar text)
         ON CONFLICT (id) DO UPDATE SET
           name_en = CASE WHEN length(EXCLUDED.name_en) > length(source_book.name_en) THEN EXCLUDED.name_en ELSE source_book.name_en END,
           name_ar = COALESCE(source_book.name_ar, EXCLUDED.name_ar)`,
        [JSON.stringify(bookRows)],
      );
    }

    const scholars = records.map(scholarRow);
    if (mode === 'replace') {
      await insertRows(client, 'scholar', SCHOLAR_COLUMNS, scholars);
    } else {
      const assignments = SCHOLAR_COLUMNS.filter(column => column !== 'id').map(column =>
        `${column} = CASE
           WHEN scholar.${column} IS NULL AND NOT EXISTS (
             SELECT 1 FROM audit_log
             WHERE entity = 'scholar' AND entity_id = scholar.id::text AND field = '${column}'
           ) THEN EXCLUDED.${column} ELSE scholar.${column} END`);
      await insertRows(
        client,
        'scholar',
        SCHOLAR_COLUMNS,
        scholars,
        `ON CONFLICT (id) DO UPDATE SET ${assignments.join(', ')}, updated_at = now()`,
      );
    }

    const conflict = mode === 'fill-empty' ? 'ON CONFLICT DO NOTHING' : '';
    await insertRows(client, 'scholar_area', ['scholar_id', 'area_id'], dedupe(
      records.flatMap(record => record.areas.map(name => ({ scholar_id: record.id, area_id: areaIds.get(name) }))),
      row => `${row.scholar_id}:${row.area_id}`,
    ), conflict);
    await insertRows(client, 'scholar_tag', ['scholar_id', 'tag_id'], dedupe(
      records.flatMap(record => record.tags.map(tag => ({ scholar_id: record.id, tag_id: tagIds.get(tag.name) }))),
      row => `${row.scholar_id}:${row.tag_id}`,
    ), conflict);
    await insertRows(client, 'scholar_place', ['scholar_id', 'place_id', 'role'], dedupe(
      records.flatMap(record => {
        const rows: { scholar_id: number; place_id: number | undefined; role: string }[] = [];
        for (const name of record.places) rows.push({ scholar_id: record.id, place_id: placeIds.get(name), role: 'stay' });
        for (const part of (record.birth?.place ?? '').split('/')) {
          const id = placeIds.get(part.trim());
          if (id) rows.push({ scholar_id: record.id, place_id: id, role: 'birth' });
        }
        for (const part of (record.death?.place ?? '').split('/')) {
          const id = placeIds.get(part.trim());
          if (id) rows.push({ scholar_id: record.id, place_id: id, role: 'death' });
        }
        return rows.filter(row => row.place_id);
      }),
      row => `${row.scholar_id}:${row.place_id}:${row.role}`,
    ), conflict);
    await insertRows(client, 'scholar_rumuz', ['scholar_id', 'code'], dedupe(
      records.flatMap(record => record.rumuz.map(code => ({ scholar_id: record.id, code }))),
      row => `${row.scholar_id}:${row.code}`,
    ), conflict);
    await insertRows(client, 'scholar_relation', ['subject_id', 'type', 'object_id', 'object_name', 'position'], dedupe(
      records.flatMap(record => record.relations.map(relation => ({
        subject_id: record.id,
        type: relation.type,
        object_id: relation.id,
        object_name: relation.name,
        position: relation.position,
      }))),
      row => `${row.subject_id}:${row.type}:${row.object_id ?? ''}:${row.object_name}`,
    ), mode === 'fill-empty' ? 'ON CONFLICT (subject_id, type, object_id, object_name) DO NOTHING' : '');
    await insertRows(client, 'name_variant', ['scholar_id', 'name_ar', 'origin'], dedupe(
      records.flatMap(record => record.variants.map(variant => ({ scholar_id: record.id, name_ar: variant.nameAr, origin: variant.origin }))),
      row => `${row.scholar_id}:${row.origin}:${row.name_ar}`,
    ), conflict);
    await insertRows(client, 'narration_count', ['scholar_id', 'collection', 'count'], dedupe(
      records.flatMap(record => record.narrations.map(narration => ({ scholar_id: record.id, collection: narration.collection, count: narration.count }))),
      row => `${row.scholar_id}:${row.collection}`,
    ), conflict);
    await insertRows(client, 'scholar_msd_ref', ['scholar_id', 'ref_no', 'locator'], dedupe(
      records.flatMap(record => record.msdRefs.map(ref => ({ scholar_id: record.id, ref_no: ref.refNo, locator: ref.locator }))),
      row => `${row.scholar_id}:${row.ref_no}:${row.locator ?? ''}`,
    ), mode === 'fill-empty' ? 'ON CONFLICT (scholar_id, ref_no, locator) DO NOTHING' : '');
    if (mode === 'replace') {
      await insertRows(client, 'source_entry', ['scholar_id', 'book_id', 'rid', 'locator', 'entry_type', 'text_ar'],
        records.flatMap(record => record.sources.filter(source => source.bookId > 0).map(source => ({
          scholar_id: record.id,
          book_id: source.bookId,
          rid: source.rid,
          locator: source.locator,
          entry_type: source.entryType,
          text_ar: source.textAr,
        }))));
    }
    await insertRows(client, 'tk_entry', [
      'scholar_id', 'tk_no', 'kunya', 'nisba', 'rank', 'tabaqa', 'death_ah', 'birth_ah', 'age',
      'countries', 'death_place', 'raw_fields', 'text_ar', 'no_entry',
    ], records.filter(record => record.tk).map(record => ({
      scholar_id: record.id,
      tk_no: record.tk?.tkNo ?? null,
      kunya: record.tk?.kunya ?? null,
      nisba: record.tk?.nisba ?? null,
      rank: record.tk?.rank ?? null,
      tabaqa: record.tk?.tabaqa ?? null,
      death_ah: record.tk?.deathAh ?? null,
      birth_ah: record.tk?.birthAh ?? null,
      age: record.tk?.age ?? null,
      countries: record.tk?.countries ?? null,
      death_place: record.tk?.deathPlace ?? null,
      raw_fields: record.tk?.rawFields ?? [],
      text_ar: record.tk?.textAr ?? null,
      no_entry: record.tk?.noEntry ?? false,
    })), mode === 'fill-empty' ? 'ON CONFLICT (scholar_id) DO NOTHING' : '');

    await client.query('REFRESH MATERIALIZED VIEW teaching_edge');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
