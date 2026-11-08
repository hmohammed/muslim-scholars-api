import { sql, type Kysely } from 'kysely';
import type { Database } from '@msapi/db';

export interface CatalogScholar {
  id: number;
  name_en: string;
  name_ar: string | null;
  category: string;
  madhhab: string | null;
  death_year_ah: number | null;
  bio: string | null;
  areas: string[];
  places: string[];
}

export interface Catalog {
  scholars: CatalogScholar[];
  edges: Array<[number, number]>;
}

interface ScholarRow {
  id: number;
  name_en: string;
  name_ar: string | null;
  category: string;
  madhhab: string | null;
  death_year_ah: number | null;
  bio: string | null;
  areas: string[] | null;
  places: string[] | null;
}

/** One payload for the dashboard: public scholar fields and teacher → student links. */
export async function buildCatalog(db: Kysely<Database>): Promise<Catalog> {
  const [scholars, edges] = await Promise.all([
    sql<ScholarRow>`
      select s.id, s.name_en, s.name_ar, s.category::text as category, s.madhhab::text as madhhab,
             s.death_year_ah, left(s.bio_text, 2000) as bio,
             coalesce((
               select json_agg(name order by name) from (
                 select a.name from scholar_area sa join area a on a.id = sa.area_id where sa.scholar_id = s.id
               ) names
             ), '[]'::json) as areas,
             coalesce((
               select json_agg(name_en order by name_en) from (
                 select distinct p.name_en from scholar_place sp join place p on p.id = sp.place_id where sp.scholar_id = s.id
               ) names
             ), '[]'::json) as places
      from scholar s
      order by s.id
    `.execute(db),
    db.selectFrom('teaching_edge').select(['teacher_id', 'student_id']).orderBy('teacher_id').orderBy('student_id').execute(),
  ]);
  return {
    scholars: scholars.rows.map(row => ({
      ...row,
      areas: row.areas ?? [],
      places: row.places ?? [],
    })),
    edges: edges.map(edge => [edge.teacher_id, edge.student_id]),
  };
}
