-- Section 6 of docs/PLAN.md, plus the search columns from section 8.
-- Category includes century_5..century_15 and relative: the crawl goes past the
-- 4th century and has a handful of "Prophet's Relative" pages.
-- normalize_ar is IMMUTABLE so generated columns and indexes can use it.
-- unaccent() is not immutable, so vowel marks are stripped here instead.

CREATE OR REPLACE FUNCTION normalize_ar(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN lower(btrim(regexp_replace(regexp_replace(
  translate(
    regexp_replace(
      coalesce(input, ''),
      '[̀-ͯ҃-҉֑-ֽً-ٰٟۖ-ۭـ]',
      '',
      'g'
    ),
    'أإآٱىة',
    'اااايه'
  ),
  '[''’`.,;:!?()\[\]{}<>/\\|؟،؛"“”«»~\-_]+',
  ' ',
  'g'
), '\s+', ' ', 'g')));

CREATE TYPE scholar_category AS ENUM (
  'prophet', 'companion', 'follower', 'successor', 'relative',
  'century_3', 'century_4', 'century_5', 'century_6', 'century_7',
  'century_8', 'century_9', 'century_10', 'century_11', 'century_12',
  'century_13', 'century_14', 'century_15'
);
CREATE TYPE madhhab AS ENUM ('hanafi', 'shafii', 'maliki', 'hanbali', 'other');
CREATE TYPE scholar_grade AS ENUM (
  'Thiqah', 'Maqbool', 'Sadooq', 'Unknown-Majhool', 'Weak', 'Sadooq/Delusion',
  'Abandoned', 'No Doubt', 'Thiqah Thiqah', 'Not Thiqah', 'Undefined', 'Liar', 'Accused Liar'
);
CREATE TYPE date_qualifier AS ENUM ('exact', 'approx', 'before', 'after', 'between', 'or');
CREATE TYPE death_cause AS ENUM ('natural', 'killed', 'martyred', 'plague', 'poisoned');
CREATE TYPE bio_lang AS ENUM ('ar', 'en', 'mixed');
CREATE TYPE relation_type AS ENUM ('teacher', 'student', 'parent', 'child', 'sibling', 'spouse');
CREATE TYPE place_role AS ENUM ('stay', 'birth', 'death');
CREATE TYPE tag_kind AS ENUM ('tribe', 'clan', 'nisba', 'battle', 'gender', 'era', 'other');
CREATE TYPE name_origin AS ENUM ('hadith_literature', 'tk');
CREATE TYPE hadith_collection AS ENUM ('bukhari', 'muslim', 'abu_dawud', 'tirmidhi', 'nasai', 'ibn_majah');
CREATE TYPE account_role AS ENUM ('developer', 'admin');

CREATE TABLE scholar (
  id int PRIMARY KEY,
  name_en text NOT NULL,
  name_ar text,
  honorific_ar text,
  short_name text,
  famous_name text,
  full_name text,
  category scholar_category NOT NULL,
  tabaqa smallint,
  madhhab madhhab,
  grade scholar_grade,
  taqrib_verdict_ar text,
  birth_year_ah int,
  birth_year_ah_alt int,
  birth_year_ce int,
  birth_qualifier date_qualifier,
  birth_place text,
  birth_date_note text,
  birth_raw text,
  death_year_ah int,
  death_year_ah_alt int,
  death_year_ce int,
  death_qualifier date_qualifier,
  death_place text,
  death_date_note text,
  death_cause death_cause,
  death_event text,
  death_raw text,
  bio_text text,
  bio_lang bio_lang,
  bio_link text,
  source_last_updated date,
  quality_flags text[] NOT NULL DEFAULT '{}',
  extra jsonb NOT NULL DEFAULT '{}',
  search_name text GENERATED ALWAYS AS (
    normalize_ar(
      coalesce(name_en, '') || ' ' || coalesce(name_ar, '') || ' ' ||
      coalesce(short_name, '') || ' ' || coalesce(famous_name, '') || ' ' ||
      coalesce(full_name, '')
    )
  ) STORED,
  bio_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(bio_text, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scholar_category_idx ON scholar (category);
CREATE INDEX scholar_death_year_idx ON scholar (death_year_ah, id);
CREATE INDEX scholar_search_name_idx ON scholar (search_name);
CREATE INDEX scholar_search_trgm_idx ON scholar USING gin (search_name gin_trgm_ops);
CREATE INDEX scholar_bio_tsv_idx ON scholar USING gin (bio_tsv);

CREATE TABLE scholar_relation (
  id bigserial PRIMARY KEY,
  subject_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  type relation_type NOT NULL,
  object_id int,
  object_name text NOT NULL,
  position smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scholar_relation_subject_idx ON scholar_relation (subject_id, type, position);
CREATE INDEX scholar_relation_object_idx ON scholar_relation (object_id) WHERE object_id IS NOT NULL;
CREATE UNIQUE INDEX scholar_relation_dedup ON scholar_relation (subject_id, type, object_id, object_name) NULLS NOT DISTINCT;

-- Deduplicated teacher → student links, both directions. Refreshed by the loader.
CREATE MATERIALIZED VIEW teaching_edge AS
SELECT DISTINCT teacher_id, student_id
FROM (
  SELECT object_id AS teacher_id, subject_id AS student_id
  FROM scholar_relation
  WHERE type = 'teacher' AND object_id IS NOT NULL
  UNION
  SELECT subject_id AS teacher_id, object_id AS student_id
  FROM scholar_relation
  WHERE type = 'student' AND object_id IS NOT NULL
) edges
WHERE teacher_id <> student_id
  AND teacher_id IN (SELECT id FROM scholar)
  AND student_id IN (SELECT id FROM scholar);

CREATE UNIQUE INDEX teaching_edge_pk ON teaching_edge (teacher_id, student_id);
CREATE INDEX teaching_edge_student_idx ON teaching_edge (student_id);

CREATE TABLE area (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scholar_area (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  area_id int NOT NULL REFERENCES area (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, area_id)
);

CREATE TABLE tag (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind tag_kind NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scholar_tag (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  tag_id int NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, tag_id)
);

CREATE TABLE place (
  id serial PRIMARY KEY,
  name_en text NOT NULL UNIQUE,
  lat double precision,
  lng double precision,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scholar_place (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  place_id int NOT NULL REFERENCES place (id) ON DELETE CASCADE,
  role place_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, place_id, role)
);

CREATE TABLE rumuz (
  code text PRIMARY KEY,
  meaning_ar text,
  meaning_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scholar_rumuz (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  code text NOT NULL REFERENCES rumuz (code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, code)
);

INSERT INTO rumuz (code, meaning_ar, meaning_en) VALUES
  ('ع', 'الستة', 'The Six Books'),
  ('خ', 'البخاري', 'Bukhari'),
  ('م', 'مسلم', 'Muslim'),
  ('د', 'أبو داود', 'Abu Dawud'),
  ('ت', 'الترمذي', 'Tirmidhi'),
  ('س', 'النسائي', 'Nasa''i'),
  ('ق', 'ابن ماجه', 'Ibn Majah'),
  ('4', 'الأربعة', 'The four Sunan'),
  ('سي', 'النسائي في اليوم والليلة', 'Nasa''i, Amal al-yawm wa al-layla'),
  ('خت', 'البخاري تعليقا', 'Bukhari, ta''liq'),
  ('بخ', 'الأدب المفرد', 'al-Adab al-Mufrad'),
  ('عخ', 'خلق أفعال العباد', 'Khalq af''al al-''ibad'),
  ('ر', 'البخاري في القراءة', 'Bukhari, al-Qira''a'),
  ('ي', 'البخاري في رفع اليدين', 'Bukhari, Raf'' al-yadayn'),
  ('تم', 'الترمذي في الشمائل', 'Tirmidhi, al-Shama''il'),
  ('مد', 'أبو داود في المراسيل', 'Abu Dawud, al-Marasil'),
  ('قد', 'أبو داود في القدر', 'Abu Dawud, al-Qadar'),
  ('خد', 'أبو داود في الناسخ والمنسوخ', 'Abu Dawud, al-Nasikh'),
  ('صد', 'أبو داود في فضائل الأنصار', 'Abu Dawud, Fada''il al-Ansar'),
  ('فق', 'ابن ماجه في التفسير', 'Ibn Majah, al-Tafsir'),
  ('ل', 'أبو داود في المسائل', 'Abu Dawud, al-Masa''il'),
  ('ف', 'أبو داود في التفرد', 'Abu Dawud, al-Tafarrud'),
  ('ك', 'المستدرك', 'al-Mustadrak'),
  ('كن', 'النسائي في الكبرى', 'Nasa''i, al-Kubra'),
  ('ص', 'النسائي في خصائص علي', 'Nasa''i, Khasa''is Ali');

CREATE TABLE name_variant (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  origin name_origin NOT NULL,
  name_norm text GENERATED ALWAYS AS (normalize_ar(name_ar)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, name_ar, origin)
);
CREATE INDEX name_variant_trgm_idx ON name_variant USING gin (name_norm gin_trgm_ops);

CREATE TABLE narration_count (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  collection hadith_collection NOT NULL,
  count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scholar_id, collection)
);

CREATE TABLE source_book (
  id int PRIMARY KEY,
  name_en text NOT NULL,
  name_ar text,
  author text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO source_book (id, name_en, name_ar, author) VALUES
  (1, 'al-Isabah', 'الإصابة في تمييز الصحابة', 'Ibn Hajar'),
  (2, 'al-Thiqat', 'كتاب الثقات', 'Ibn Hibban'),
  (3, 'al-Tarikh al-Kabir', 'التاريخ الكبير', 'al-Bukhari'),
  (4, 'al-Tabaqat al-Kubra', 'الطبقات الكبرى', 'Ibn Sa''d'),
  (5, 'Siyar A''lam al-Nubala', 'سير أعلام النبلاء', 'al-Dhahabi'),
  (6, 'Lisan al-Mizan', 'لسان الميزان', 'Ibn Hajar'),
  (7, 'Tahdheeb al-Tahdheeb', 'تهذيب التهذيب', 'Ibn Hajar'),
  (8, 'Mizan al-I''tidal', 'ميزان الاعتدال', 'al-Dhahabi'),
  (9, 'Taqrib al-Tahdheeb', 'تقريب التهذيب', 'Ibn Hajar');

CREATE TABLE source_entry (
  id bigserial PRIMARY KEY,
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  book_id int NOT NULL REFERENCES source_book (id),
  rid int,
  locator text,
  entry_type text,
  text_ar text,
  text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text_ar, ''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_entry_scholar_idx ON source_entry (scholar_id, book_id);
CREATE INDEX source_entry_tsv_idx ON source_entry USING gin (text_tsv);

CREATE TABLE msd_reference (
  ref_no int PRIMARY KEY,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scholar_msd_ref (
  scholar_id int NOT NULL REFERENCES scholar (id) ON DELETE CASCADE,
  ref_no int NOT NULL REFERENCES msd_reference (ref_no),
  locator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scholar_msd_ref_scholar_idx ON scholar_msd_ref (scholar_id);
CREATE UNIQUE INDEX scholar_msd_ref_dedup ON scholar_msd_ref (scholar_id, ref_no, locator) NULLS NOT DISTINCT;

CREATE TABLE tk_entry (
  scholar_id int PRIMARY KEY REFERENCES scholar (id) ON DELETE CASCADE,
  tk_no int,
  kunya text,
  nisba text,
  rank text,
  tabaqa smallint,
  death_ah int,
  birth_ah int,
  age smallint,
  countries text,
  death_place text,
  raw_fields text[] NOT NULL DEFAULT '{}',
  text_ar text,
  no_entry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account (
  id bigserial PRIMARY KEY,
  github_id bigint NOT NULL UNIQUE,
  login text NOT NULL,
  email text,
  role account_role NOT NULL DEFAULT 'developer',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE api_key (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  hash text NOT NULL,
  per_day int NOT NULL DEFAULT 1000,
  per_second int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_key_prefix_idx ON api_key (prefix);

CREATE TABLE usage_daily (
  api_key_id bigint NOT NULL REFERENCES api_key (id) ON DELETE CASCADE,
  day date NOT NULL,
  requests int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, day)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  account_id bigint REFERENCES account (id),
  entity text NOT NULL,
  entity_id text NOT NULL,
  field text NOT NULL,
  old jsonb,
  new jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

CREATE TABLE dataset_release (
  id bigserial PRIMARY KEY,
  version text NOT NULL UNIQUE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
