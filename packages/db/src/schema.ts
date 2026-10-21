import type { ColumnType, Generated } from 'kysely';

export type ScholarCategory =
  | 'prophet' | 'companion' | 'follower' | 'successor' | 'relative'
  | 'century_3' | 'century_4' | 'century_5' | 'century_6' | 'century_7'
  | 'century_8' | 'century_9' | 'century_10' | 'century_11' | 'century_12'
  | 'century_13' | 'century_14' | 'century_15';

export type Madhhab = 'hanafi' | 'shafii' | 'maliki' | 'hanbali' | 'other';

export type ScholarGrade =
  | 'Thiqah' | 'Maqbool' | 'Sadooq' | 'Unknown-Majhool' | 'Weak' | 'Sadooq/Delusion'
  | 'Abandoned' | 'No Doubt' | 'Thiqah Thiqah' | 'Not Thiqah' | 'Undefined' | 'Liar' | 'Accused Liar';

export type DateQualifier = 'exact' | 'approx' | 'before' | 'after' | 'between' | 'or';
export type DeathCause = 'natural' | 'killed' | 'martyred' | 'plague' | 'poisoned';
export type BioLang = 'ar' | 'en' | 'mixed';
export type RelationType = 'teacher' | 'student' | 'parent' | 'child' | 'sibling' | 'spouse';
export type PlaceRole = 'stay' | 'birth' | 'death';
export type TagKind = 'tribe' | 'clan' | 'nisba' | 'battle' | 'gender' | 'era' | 'other';
export type NameOrigin = 'hadith_literature' | 'tk';
export type HadithCollection = 'bukhari' | 'muslim' | 'abu_dawud' | 'tirmidhi' | 'nasai' | 'ibn_majah';
export type AccountRole = 'developer' | 'admin';

export interface ScholarExtra {
  books?: { id: number; title: string }[];
  sections?: Record<string, string>;
  grade_raw?: string;
  category_note?: string;
}

interface Stamped {
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ScholarTable extends Stamped {
  id: number;
  name_en: string;
  name_ar: string | null;
  honorific_ar: string | null;
  short_name: string | null;
  famous_name: string | null;
  full_name: string | null;
  category: ScholarCategory;
  tabaqa: number | null;
  madhhab: Madhhab | null;
  grade: ScholarGrade | null;
  taqrib_verdict_ar: string | null;
  birth_year_ah: number | null;
  birth_year_ah_alt: number | null;
  birth_year_ce: number | null;
  birth_qualifier: DateQualifier | null;
  birth_place: string | null;
  birth_date_note: string | null;
  birth_raw: string | null;
  death_year_ah: number | null;
  death_year_ah_alt: number | null;
  death_year_ce: number | null;
  death_qualifier: DateQualifier | null;
  death_place: string | null;
  death_cause: DeathCause | null;
  death_event: string | null;
  death_date_note: string | null;
  death_raw: string | null;
  bio_text: string | null;
  bio_lang: BioLang | null;
  bio_link: string | null;
  source_last_updated: ColumnType<Date | null, string | null, string | null>;
  quality_flags: string[];
  extra: ColumnType<ScholarExtra, ScholarExtra, ScholarExtra>;
  search_name: Generated<string>;
  bio_tsv: Generated<string>;
}

export interface ScholarRelationTable extends Stamped {
  id: Generated<number>;
  subject_id: number;
  type: RelationType;
  object_id: number | null;
  object_name: string;
  position: number;
}

export interface TeachingEdgeTable {
  teacher_id: number;
  student_id: number;
}

export interface AreaTable extends Stamped {
  id: Generated<number>;
  name: string;
}
export interface ScholarAreaTable extends Stamped {
  scholar_id: number;
  area_id: number;
}

export interface TagTable extends Stamped {
  id: Generated<number>;
  name: string;
  kind: TagKind;
}
export interface ScholarTagTable extends Stamped {
  scholar_id: number;
  tag_id: number;
}

export interface PlaceTable extends Stamped {
  id: Generated<number>;
  name_en: string;
  lat: number | null;
  lng: number | null;
  country: string | null;
}
export interface ScholarPlaceTable extends Stamped {
  scholar_id: number;
  place_id: number;
  role: PlaceRole;
}

export interface RumuzTable extends Stamped {
  code: string;
  meaning_ar: string | null;
  meaning_en: string | null;
}
export interface ScholarRumuzTable extends Stamped {
  scholar_id: number;
  code: string;
}

export interface NameVariantTable extends Stamped {
  scholar_id: number;
  name_ar: string;
  origin: NameOrigin;
  name_norm: Generated<string>;
}

export interface NarrationCountTable extends Stamped {
  scholar_id: number;
  collection: HadithCollection;
  count: number;
}

export interface SourceBookTable extends Stamped {
  id: number;
  name_en: string;
  name_ar: string | null;
  author: string | null;
}

export interface SourceEntryTable extends Stamped {
  id: Generated<number>;
  scholar_id: number;
  book_id: number;
  rid: number | null;
  locator: string | null;
  entry_type: string | null;
  text_ar: string | null;
  text_tsv: Generated<string>;
}

export interface MsdReferenceTable extends Stamped {
  ref_no: number;
  title: string | null;
}
export interface ScholarMsdRefTable extends Stamped {
  scholar_id: number;
  ref_no: number;
  locator: string | null;
}

export interface TkEntryTable extends Stamped {
  scholar_id: number;
  tk_no: number | null;
  kunya: string | null;
  nisba: string | null;
  rank: string | null;
  tabaqa: number | null;
  death_ah: number | null;
  birth_ah: number | null;
  age: number | null;
  countries: string | null;
  death_place: string | null;
  raw_fields: string[];
  text_ar: string | null;
  no_entry: boolean;
}

export interface AccountTable extends Stamped {
  id: Generated<number>;
  github_id: number;
  login: string;
  email: string | null;
  role: AccountRole;
  disabled_at: Date | null;
}

export interface ApiKeyTable extends Stamped {
  id: Generated<number>;
  account_id: number;
  name: string;
  prefix: string;
  hash: string;
  per_day: number;
  per_second: number;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface UsageDailyTable extends Stamped {
  api_key_id: number;
  day: ColumnType<Date, string, string>;
  requests: number;
}

export interface AuditLogTable extends Stamped {
  id: Generated<number>;
  account_id: number | null;
  entity: string;
  entity_id: string;
  field: string;
  old: ColumnType<unknown, unknown, unknown>;
  new: ColumnType<unknown, unknown, unknown>;
  at: Generated<Date>;
}

export interface DatasetReleaseTable extends Stamped {
  id: Generated<number>;
  version: string;
  notes: string | null;
}

export interface Database {
  scholar: ScholarTable;
  scholar_relation: ScholarRelationTable;
  teaching_edge: TeachingEdgeTable;
  area: AreaTable;
  scholar_area: ScholarAreaTable;
  tag: TagTable;
  scholar_tag: ScholarTagTable;
  place: PlaceTable;
  scholar_place: ScholarPlaceTable;
  rumuz: RumuzTable;
  scholar_rumuz: ScholarRumuzTable;
  name_variant: NameVariantTable;
  narration_count: NarrationCountTable;
  source_book: SourceBookTable;
  source_entry: SourceEntryTable;
  msd_reference: MsdReferenceTable;
  scholar_msd_ref: ScholarMsdRefTable;
  tk_entry: TkEntryTable;
  account: AccountTable;
  api_key: ApiKeyTable;
  usage_daily: UsageDailyTable;
  audit_log: AuditLogTable;
  dataset_release: DatasetReleaseTable;
}
