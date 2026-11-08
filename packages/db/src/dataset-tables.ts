// Public tables in a dataset download. Generated search columns and the
// platform tables (accounts, keys, usage, audit) stay out.

export type DatasetKind = 'int' | 'real' | 'text' | 'bool' | 'json' | 'date';

export interface DatasetColumn {
  name: string;
  kind: DatasetKind;
}

export interface DatasetTable {
  name: string;
  columns: DatasetColumn[];
  orderBy: string[];
  primaryKey: string[];
}

export const DATASET_FILES = {
  sqlite: 'muslim-scholars.sqlite',
  json: 'muslim-scholars.json',
  csv: 'muslim-scholars.csv.zip',
} as const;

export type DatasetFileName = (typeof DATASET_FILES)[keyof typeof DATASET_FILES];

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function isDatasetVersion(version: string): boolean {
  return VERSION.test(version);
}

function col(kind: DatasetKind, names: string[]): DatasetColumn[] {
  return names.map(name => ({ name, kind }));
}

function table(name: string, columns: DatasetColumn[], primaryKey: string[]): DatasetTable {
  return { name, columns, orderBy: primaryKey, primaryKey };
}

export const DATASET_TABLES: DatasetTable[] = [
  table('scholar', [
    ...col('int', ['id']),
    ...col('text', [
      'name_en', 'name_ar', 'honorific_ar', 'short_name', 'famous_name', 'full_name',
      'category', 'madhhab', 'grade', 'taqrib_verdict_ar',
    ]),
    ...col('int', ['tabaqa', 'birth_year_ah', 'birth_year_ah_alt', 'birth_year_ce']),
    ...col('text', ['birth_qualifier', 'birth_place', 'birth_date_note', 'birth_raw']),
    ...col('int', ['death_year_ah', 'death_year_ah_alt', 'death_year_ce']),
    ...col('text', [
      'death_qualifier', 'death_place', 'death_date_note', 'death_cause', 'death_event', 'death_raw',
      'bio_text', 'bio_lang', 'bio_link',
    ]),
    ...col('date', ['source_last_updated']),
    ...col('json', ['quality_flags', 'extra']),
  ], ['id']),
  table('scholar_relation', [
    ...col('int', ['id', 'subject_id', 'object_id', 'position']),
    ...col('text', ['type', 'object_name']),
  ], ['id']),
  table('area', [
    ...col('int', ['id']),
    ...col('text', ['name']),
  ], ['id']),
  table('scholar_area', [
    ...col('int', ['scholar_id', 'area_id']),
  ], ['scholar_id', 'area_id']),
  table('tag', [
    ...col('int', ['id']),
    ...col('text', ['name', 'kind']),
  ], ['id']),
  table('scholar_tag', [
    ...col('int', ['scholar_id', 'tag_id']),
  ], ['scholar_id', 'tag_id']),
  table('place', [
    ...col('int', ['id']),
    ...col('text', ['name_en']),
    ...col('real', ['lat', 'lng']),
    ...col('text', ['country']),
  ], ['id']),
  table('scholar_place', [
    ...col('int', ['scholar_id', 'place_id']),
    ...col('text', ['role']),
  ], ['scholar_id', 'place_id', 'role']),
  table('rumuz', [
    ...col('text', ['code', 'meaning_ar', 'meaning_en']),
  ], ['code']),
  table('scholar_rumuz', [
    ...col('int', ['scholar_id']),
    ...col('text', ['code']),
  ], ['scholar_id', 'code']),
  table('name_variant', [
    ...col('int', ['scholar_id']),
    ...col('text', ['name_ar', 'origin']),
  ], ['scholar_id', 'name_ar', 'origin']),
  table('narration_count', [
    ...col('int', ['scholar_id', 'count']),
    ...col('text', ['collection']),
  ], ['scholar_id', 'collection']),
  table('source_book', [
    ...col('int', ['id']),
    ...col('text', ['name_en', 'name_ar', 'author']),
  ], ['id']),
  table('source_entry', [
    ...col('int', ['id', 'scholar_id', 'book_id', 'rid']),
    ...col('text', ['locator', 'entry_type', 'text_ar']),
  ], ['id']),
  table('msd_reference', [
    ...col('int', ['ref_no']),
    ...col('text', ['title']),
  ], ['ref_no']),
  table('scholar_msd_ref', [
    ...col('int', ['scholar_id', 'ref_no']),
    ...col('text', ['locator']),
  ], ['scholar_id', 'ref_no', 'locator']),
  table('tk_entry', [
    ...col('int', ['scholar_id', 'tk_no', 'tabaqa', 'death_ah', 'birth_ah', 'age']),
    ...col('text', ['kunya', 'nisba', 'rank', 'countries', 'death_place', 'text_ar']),
    ...col('json', ['raw_fields']),
    ...col('bool', ['no_entry']),
  ], ['scholar_id']),
  table('teaching_edge', [
    ...col('int', ['teacher_id', 'student_id']),
  ], ['teacher_id', 'student_id']),
];
