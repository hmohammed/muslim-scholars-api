# Muslim Scholars API: implementation plan

Status: **draft for review**. Nothing is implemented yet.

Decisions marked **⚑** were made by Claude on your behalf after the interview, mostly in the database design. Every other decision comes from the interview (Q1–Q23). Please check the ⚑ items before implementation starts.

---

## 1. Goal

Build a public, documented, read-only REST API over the ~25k scholar records crawled from muslimscholars.info (Arees Institute, inactive since about 2012). Third-party developers use it with API keys. The islamic-scholars-dashboard becomes one of its clients later.

## 2. Settled decisions (from the interview)

| # | Decision |
|---|---|
| Q1 | A public developer platform from day one, built as its own project. The dashboard comes later. |
| Q2 | Serve all data, including biographies and source texts, credited to Arees. |
| Q3 | Real query needs: search, combined filters, graph queries, admin corrections. |
| Q4 | Paid hosting is fine. Keep upkeep low. Pure JS/TS. |
| Q5 | TypeScript, Node 24 LTS, Fastify, TypeBox schemas, Swagger generated from code. |
| Q6 | PostgreSQL, run locally with Docker Compose. |
| Q7 | One API key per developer in the `X-API-Key` header, stored hashed, with a per-key rate limit. No refresh tokens. |
| Q8 | A key is always required. Sign-up is instant and free. A low-limit "Try it" key for the docs. |
| Q9 | The public API is read-only. Only the admin can make corrections, and every change goes in an audit log. |
| Q10 | After import, the database is the master copy and the raw HTML is archived. Before launch the import can be rerun; after launch a re-parse only fills empty fields. |
| Q11 | A separate repo, `Hobby projects/muslim-scholars-api`. |
| Q12 | Every record carries attribution and a source URL. The docs have an attribution and takedown page. |
| Q13 | Railway (EU) for the API and Postgres, with Cloudflare in front. |
| Q14 | Developers sign in with GitHub to create, revoke and track usage of their keys. |
| Q15 | One free plan, with limits stored per key. |
| Q16 | `/v1/`, snake_case JSON, `{en, ar}` names, cursor pagination, `?include=`, RFC 9457 errors, original site IDs. |
| Q17 | Versioned full-dataset downloads, after launch. |
| Q18 | Railway's default address while testing; buy a domain before launch. |
| Q19 | Admin uses the same GitHub sign-in. `/admin/*` is left out of the public docs. |
| Q20 | Railway backups, plus a nightly `pg_dump` and the raw-HTML archive in Cloudflare R2. |
| Q21 | GitHub repo. GitHub Actions runs checks. Railway auto-deploys `main` after checks pass. |
| Q22 | Vitest against real Postgres in Docker, plus golden tests for the parser. |
| Q23 | Structured logs, per-key usage counters in Postgres, Sentry free tier. |

## 3. What the data contains (from the survey of 18,444 cached pages, 243 MB)

Each page holds much more than the current `parse.mjs` extracts:

| Content | Coverage | Notes |
|---|---|---|
| Header name (English + Arabic) | ~100% | 7,807 end with a garbled `( رضي الله عنه` honorific; strip it into a flag |
| Category | 100% | Companion 7,806 · Follower 6,893 · Successor 2,488 · 3rd century 1,104 · 4th century 1 · the Prophet ﷺ 1 |
| Tabaqa (generation layer) | 40% | Layers 1–12; spelling and capitalisation vary |
| Madhhab | Few (all century pages) | Second `[ ]` bracket in the category cell; **currently dropped** |
| Grade (English) | 58% | 13 values (Thiqah, Maqbool, Sadooq, …) |
| Hadith-collection codes (rumuz, e.g. `ع`, `د س`) + Arabic Taqrib verdict | 39% | 340 distinct code strings; **currently dropped** |
| Areas of interest | ~100% | 88 values; currently truncated in 371 files |
| Birth / death | 42% / 28% with a year | 43 / 211 text formats (before Hijra, ~, or, before/after, Hijri month notes) |
| Places of stay | 75% | English, separated by `/` or `,` |
| Teachers / students | 70% / 32% | ~63k links to other scholars + ~10k unlinked names (some Arabic) |
| Parents / siblings / children / spouses | 17% / 11% / 9% / 6% | Linked + unlinked; parents often written `father / mother` |
| Tags | 63% | 918 distinct, mixing tribe, clan, nisba, battle, gender and era |
| Short biography (bio div) | 39% non-empty | Mostly short Arabic notes; only 67 longer than 500 characters; 29 external links |
| **Tahdheeb al-Kamal block (Arabic)** | 28% | Unlabelled fields in a fixed order (empty ones skipped) + full Arabic entry with teacher and student lists |
| **Source texts (Arabic)** | 70% | 63,700 entries from 9 classical books (Ibn Hibban, Bukhari's Tarikh, Ibn Sa'd, Siyar, Lisan, Tahdheeb, Mizan, Taqrib, Isabah); includes the jarh wa ta'dil (narrator criticism) quotes |
| Name variants in hadith literature (Arabic) | 32% | Comma-separated list |
| Narration counts per collection | 21% | Bukhari, Muslim, Abu Dawud, Tirmidhi, Nasa'i, Ibn Majah |
| Site reference numbers | ~100% | `27[pg:563]` → refs.php reference list (not crawled yet) |
| Books/Work | 13 files | Book page IDs only |

Known bad data:
- **ID 2 (Abu Bakr)** is 15–21 MB of unrelated al-Isabah entries. Import its scalar fields and drop its source entries.
- ID 30003 contains a U+FFFD replacement character.
- 22 IDs have no Arabic name.

## 4. Architecture

```
          Cloudflare (DNS, TLS, DDoS; no edge caching of keyed data, see ⚑ 4.1)
                │
     Railway ── API service (Fastify, Node 24) ──── Railway Postgres 17
                │   ├─ /v1/*      public, API key
                │   ├─ /docs      Swagger UI + attribution page
                │   ├─ /portal    developer key management (GitHub session)
                │   └─ /admin/*   admin (GitHub session, role=admin)
                │
     GitHub Actions ── nightly pg_dump ──► Cloudflare R2 (+ raw HTML archive)
     Sentry ◄── errors
```

**⚑ 4.1 Edge caching.** Q13 assumed Cloudflare would cache common requests. That doesn't work cleanly here: edge-cached responses would skip the API-key check and the usage counting. Cloudflare will provide DNS, TLS and DDoS protection, and cache only `/docs` and dataset downloads. Data responses use ETags plus an in-process cache, which is plenty for this data size.

**⚑ 4.2 Graph queries run in memory.** About 25k scholars and ~70k relationship links fit in a few MB of RAM. The API loads them into memory at startup and reloads after an admin edit. Chain and network queries then use breadth-first search in Node. This is simpler and much faster than recursive SQL queries. Postgres stays the master copy and still handles search and filters.

## 5. Repo layout

```
muslim-scholars-api/
├─ docker-compose.yml          # postgres:17 (+ pg_trgm, unaccent)
├─ .env.example                # every variable documented; .env is git-ignored
├─ package.json                # npm workspaces
├─ packages/
│  ├─ importer/                # HTML → parsed records → Postgres
│  │  ├─ src/parse/            # pure functions, one file per section
│  │  ├─ src/load.ts           # transactional load / fill-empty-only mode
│  │  ├─ src/report.ts         # data-quality report (coverage, anomalies)
│  │  └─ test/golden/          # selected pages + expected JSON
│  ├─ db/                      # Kysely types + SQL migrations + seeds
│  └─ api/
│     ├─ src/routes/v1/        # scholars, search, graph, lookups, meta
│     ├─ src/routes/portal/    # GitHub OAuth, key CRUD
│     ├─ src/routes/admin/
│     ├─ src/graph/            # in-memory graph + BFS
│     ├─ src/auth/             # key verification, rate limits, sessions
│     └─ test/
├─ docs/
│  ├─ PLAN.md                  # this file
│  ├─ attribution.md           # served on /docs
│  └─ decisions/               # short ADRs for ⚑ items once confirmed
└─ .github/workflows/          # ci.yml, backup.yml
```

**⚑ 5.1 Libraries.**
- **Kysely** (type-safe SQL query builder) plus plain SQL migrations. It stays close to SQL, which suits full-text and trigram search. Drizzle was the alternative.
- **npm workspaces**.
- **`@fastify/rate-limit`, `@fastify/oauth2`, `@fastify/secure-session`, `@fastify/swagger(-ui)`**.

## 6. Database design ⚑ (all of section 6 is a proposal)

Conventions:
- The primary key is the original site ID (`scholar.id int`).
- Years are stored as AH integers; **before-Hijra years are negative** (53 BH → -53).
- Every table gets `created_at` and `updated_at`.
- Each parsed section also keeps its raw text, so the parser can be improved without re-crawling.

### 6.1 Core

**`scholar`**

| column | type | source |
|---|---|---|
| id | int PK | Scholar row |
| name_en, name_ar | text | header (honorific removed) |
| honorific_ar | text null | e.g. رضي الله عنه |
| short_name, famous_name | text | Scholar row, with nested `[ [ ] ]` handled |
| full_name | text | Full Name |
| category | enum `prophet, companion, follower, successor, century_3, century_4` | category cell |
| tabaqa | smallint null | normalised from "6th generation" |
| madhhab | enum `hanafi, shafii, maliki, hanbali, other` null | second bracket |
| grade | enum (13 values) null | `[Grade:X]` |
| taqrib_verdict_ar | text null | after the rumuz codes |
| birth_* / death_* | see 6.2 | |
| bio_text | text null | bio div; simple HTML stripped to text/markdown |
| bio_lang | `ar, en, mixed` | detected |
| bio_link | text null | trailing external link |
| source_last_updated | date | Last Updated |
| quality_flags | text[] | e.g. `corrupt_sources`, `no_arabic_name`, `replacement_char` |
| extra | jsonb | Books/Work IDs, timeline ID lists, anything with no column yet |
| search_* | generated | see section 8 |

### 6.2 Dates (columns on `scholar`, repeated for `birth_` and `death_`)

| column | example input → value |
|---|---|
| `_year_ah` int | `150 AH` → 150, `53 BH` → -53, `~128` → 128 |
| `_year_ah_alt` int | `105 AH or 95 AH` → 95 |
| `_year_ce` int | `767 CE` |
| `_qualifier` enum `exact, approx, before, after, between, or` | `~`, `<`/`before`, `>`/`after`/`or later`, `9-9`, `or` |
| `_place` text | `(Kufa, Iraq)`; nested `(Makran (India))` handled |
| `_date_note` text | `9th Rabi' awwal`, `approx`, `est.` |
| `_cause` enum `natural, killed, martyred, plague, poisoned` (death only) | |
| `_event` text (death only) | `Uhud`, `Yamamah`: spelling variants mapped to one name |
| `_raw` text | always kept |

Rule: when a date has no year and no place, the site's default cause "Natural" is **dropped**. This affects 13,173 records.

### 6.3 Relations

**`scholar_relation`**: the relationships exactly as each page states them.

| column | type |
|---|---|
| id | bigserial |
| subject_id | int → scholar (the page they came from) |
| type | enum `teacher, student, parent, child, sibling, spouse` |
| object_id | int null → scholar (null when the name isn't linked) |
| object_name | text (as written; may be Arabic) |
| position | smallint (order on the page) |

**`teaching_edge`** (materialised view): the deduplicated teacher → student links between linked scholars, combining both directions, because a link is often recorded on only one side. The in-memory graph is built from this view.

### 6.4 Classification lists

| table | content |
|---|---|
| `area` (id, name) + `scholar_area` | 88 values |
| `tag` (id, name, kind) + `scholar_tag` | 918 tags. `kind` = tribe/clan/nisba/battle/gender/era/other, assigned by rules (`B.x` → clan, battles list, `Female` → gender) plus manual review |
| `place` (id, name_en, lat, lng, country) + `scholar_place` (role: stay/birth/death) | Starts with names only; geocoding comes later (the dashboard's `locationMapping.ts` can be reused) |
| `rumuz` (code, meaning_ar, meaning_en) + `scholar_rumuz` | Seeded by hand (`ع` = the Six Books, `خ` = Bukhari, …), ~25 base codes; the 340 strings are combinations |
| `name_variant` (scholar_id, name_ar, origin: `hadith_literature`/`tk`) | 5,855 pages |
| `narration_count` (scholar_id, collection enum, count) | 6 collections |

### 6.5 Sources

| table | content |
|---|---|
| `source_book` (id = the site's book number 1–9, name_en, name_ar, author) | seeded |
| `source_entry` (id, scholar_id, book_id, rid null, locator, entry_type, text_ar) | 63.7k entries; built from the References links and the hidden source texts, matched on (book, rid). Empty-RID stub links are stored without text. ID 2 is skipped. |
| `msd_reference` (ref_no, title …) + `scholar_msd_ref` (scholar_id, ref_no, locator) | Reference list numbers. **Needs one extra page, `refs.php`** (open item 13.2) |
| `tk_entry` (scholar_id PK, tk_no, raw_fields text[], text_ar, + typed columns) | Tahdheeb al-Kamal. Because empty fields are skipped, positions shift. The typed columns (kunya, nisba, rank, tabaqa, death/birth AH, age, countries, death place) are only filled when a field's value can be identified with confidence; `raw_fields` is always kept. 287 "no entry" pages are flagged. |

### 6.6 Platform

| table | content |
|---|---|
| `account` (id, github_id, login, email, role `developer, admin`, created_at, disabled_at) | |
| `api_key` (id, account_id, name, prefix, hash, per_day, per_second, created_at, last_used_at, revoked_at) | The key looks like `msk_live_<prefix>_<secret>` and is hashed with SHA-256 + a server-side pepper. It is shown once. |
| `usage_daily` (api_key_id, day, requests) | Counted in memory and written to the database every ~10 s |
| `audit_log` (id, account_id, entity, entity_id, field, old jsonb, new jsonb, at) | Written by admin routes in the same transaction |
| `dataset_release` | later (Q17) |

**⚑ 6.7 Rate-limit storage.** Per-second limits are kept in memory, which is correct for a single Railway instance. Daily quotas live in Postgres. Redis only comes in if you ever run several instances.

## 7. Importer (parser v2)

This is a full rewrite of `parse.mjs` in TypeScript. It takes HTML text in and returns a record out (no database or network access), with one module per page section. It fixes every problem the survey found:

1. Header: Arabic split, honorific removed, 22 pages with no Arabic flagged.
2. Scholar row: nested brackets in the famous name; madhhab read from the second bracket or from the tabaqa slot (20003, 20004, 21262, 30003, 40010).
3. Area of Interest: keep the items **after** the codes bracket (371 files); extract the rumuz codes and the Arabic verdict, in both their span and plain forms; stop `Narrator [ … ]` leaking into areas.
4. Dates: a grammar covering all 43 + 211 observed formats, tested against every distinct format string.
5. Person lists: split unlinked names on `,` and `/` (parents written `father / mother` → 2 relations); drop leftover `, ,`.
6. References: the site reference numbers, (book, rid, locator), and empty-RID stubs.
7. Source texts: the "Names used" list, `<hr>`-separated entries joined to their links by (book, rid), and the entry type.
8. Tahdheeb al-Kamal block: `raw_fields` plus confident typed fields (patterns below), and the main text.
9. Narration counts from the qaalaRasulAllah links.
10. Bio: text, language detection, external link; a few long ones converted from HTML to markdown.
11. Timeline/family ID lists → `extra` (useful for cross-checking relations).

How Tahdheeb al-Kamal fields are recognised: the record number comes first, the scholar's ID last, and the trailing flag is "1". Years are 1–3 digit numbers in the order tabaqa, death, birth, age. Text fields are matched by shape: a kunya starts with أبو/أم; nisba is a comma list of words with ال-…ي; rank matches a known vocabulary (ثقة, صدوق, صحابي, …). If a value can't be placed confidently, it stays only in `raw_fields`.

**Loading.** One transaction: create staging tables, bulk insert with `COPY`, swap them in, refresh `teaching_edge`. Pre-launch mode replaces everything. Post-launch "fill-empty" mode only updates columns that are null and never touches anything recorded in `audit_log`.

**Data-quality report.** After each import, generate `import-report.md` listing coverage per field, unparsed date formats, unidentified Tahdheeb al-Kamal fields, links to missing IDs, and the ⚑ flags. This is the acceptance artefact for milestone 1.

## 8. Search

- An Arabic normaliser written as a SQL `IMMUTABLE` function and mirrored in TypeScript. It removes vowel marks (tashkeel) and the stretching character (tatweel), maps أ إ آ ٱ → ا, ى → ي, ة → ه, and strips punctuation.
- Generated columns: `search_name` (en + ar + short + famous + full + variants, normalised), plus `tsvector`s for bio and source text using the `simple` configuration (Postgres has no Arabic stemmer).
- Fuzzy name matching uses `pg_trgm` GIN indexes, which handle transliteration noise like `Hmad`/`Hammad` and `Mrthd`/`Marthad`. Results are ranked by exact match, then prefix, then similarity.
- `GET /v1/search?q=` covers names and variants. `GET /v1/scholars?text=` searches inside bios and source texts.

## 9. API surface (v1)

All routes need `X-API-Key`. Responses look like `{ data, meta: { next_cursor? }, attribution }`, and errors follow RFC 9457 `application/problem+json`.

| Method & path | Purpose |
|---|---|
| `GET /v1/scholars` | List and filter: `q, category, tabaqa, madhhab, grade, death_from, death_to, area, tag, place, has_bio, has_tk, sort, limit≤100, cursor, include` |
| `GET /v1/scholars/{id}` | Detail; `include=relations,sources,tk,rumuz,narrations,variants` |
| `GET /v1/scholars/{id}/relations?type=` | Relations as recorded, with linked and unlinked names |
| `GET /v1/scholars/{id}/teachers` · `/students` | Combined from both directions |
| `GET /v1/scholars/{id}/network?depth=1..3&limit=` | Nearby teachers and students as nodes and edges |
| `GET /v1/scholars/{id}/chain?to=companions\|{id}&max_depth=` | Shortest teacher chains |
| `GET /v1/scholars/{id}/sources?book=` | Arabic source entries |
| `GET /v1/search?q=&lang=` | Fuzzy name search in Arabic and English |
| `GET /v1/areas` · `/tags` · `/places` · `/books` · `/rumuz` | Lookup lists with counts |
| `GET /v1/stats` | Counts by category, century, grade, … |
| `GET /v1/meta` | Dataset version, import date, attribution, licence note |
| `GET /healthz` | No key needed |
| `/docs`, `/openapi.json`, `/docs/attribution` | No key needed |
| `/portal/*` | GitHub sign-in; create, name, revoke and view usage for keys (small server-rendered pages) |
| `/admin/*` | Edit scholar fields and relations, view the audit log, set per-key limits, disable accounts. **Not in the public docs** |

Default limits (stored per key, editable): **1,000/day, 10/s**. The "Try it" docs key: **100/day, 2/s**, scoped by IP.

## 10. Security

- Secrets live only in environment variables: GitHub OAuth client ID/secret, session key, key-hash pepper, Sentry DSN, R2 credentials. `.env` is git-ignored, and there's a `.env.example` without values. **You create these yourself; Claude won't handle the actual values.**
- Keys are hashed and compared in constant time. Only the prefix is shown in the portal.
- Session cookies are `HttpOnly`, `Secure` and `SameSite=Lax`; admin and portal routes also get CSRF protection.
- Every input is validated by its TypeBox schema. All SQL is parameterised (Kysely).
- CORS allows any origin for `/v1` (keys are meant for server-side use; the docs say not to put keys in browser code). The portal and admin are same-origin only.
- Request logs never include keys, only the key ID.

## 11. Testing

- **Parser:** golden tests on ~30 selected pages (Abu Hanifa, ID 1, ID 2, before-Hijra dates, nested brackets, the madhhab-in-tabaqa cases, Tahdheeb al-Kamal variants, `/`-separated parents, plain-bracket codes, pages with no Arabic). There's also a test that checks every distinct date format from the survey parses or is reported.
- **API:** Vitest + a real Postgres from Docker Compose, loaded with a small fixture import. Covers search ranking, filters, cursor paging, chain BFS, rate limits, key revocation, admin audit logging.
- **Contract:** CI fails if `/openapi.json` doesn't validate or changes without a snapshot update.
- **CI:** type-check, lint, tests on every push.

## 12. Milestones

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Repo, Docker Compose Postgres, workspaces, CI skeleton, `.env.example` | `docker compose up` + `npm test` pass from a clean checkout |
| **M1** | Parser v2 + golden tests + loader + quality report | The full crawl imports locally; the report shows no unparsed date formats and you've reviewed it |
| **M2** | Read API: scholars list/detail/search/lookups/meta + Swagger | Every route documented at `/docs` and tested; locally without keys |
| **M3** | Graph: in-memory graph, teachers/students, network, chain | Chain from al-Bukhari to a Companion returns correct paths, under 50 ms |
| **M4** | Accounts and keys: GitHub OAuth, portal, keys, rate limits, usage, admin, audit | Full sign-in → key → call → revoke flow tested |
| **M5** | Deploy: Railway (EU), Cloudflare, Sentry, R2 nightly backups + HTML archive, attribution page | Public on `*.up.railway.app`; restoring from a backup has been tested once |
| M6 | Domain + launch checklist | Domain bought, `api.<domain>` live |
| M7 | Dataset downloads (JSON/CSV/SQLite) | Q17 |
| M8 | Dashboard moves to the API | Separate project |

M0–M3 run entirely on your machine. Nothing needs an account or deployment until M4/M5.

## 13. Open items and prerequisites

1. **Finish the crawl.** Let the sweep up to 41000 finish, then probe every 100th ID between 41000 and 100000 for another block (one extra crawler option). M1's final run needs the full cache; development can start on the current ~18k.
2. **`refs.php`.** The site reference numbers point to the site's own reference list. Fetching that one page means **one** extra request to the site. OK?
3. **Install Node 24 LTS** with nvm. Docker is already installed.
4. **Accounts, needed by M4/M5, not now:** GitHub (repo + OAuth app), Railway (billing), Cloudflare (R2 + DNS later), Sentry.
5. **Tag kinds and the rumuz table** need a short manual review by you (918 tags, ~25 codes). I'll propose them and you correct.
6. **The Tahdheeb al-Kamal typed fields** are a best-effort extraction. The quality report will show how many could be identified, and we'll decide then whether that's good enough.
7. **Attribution wording** for the API and docs. I'll draft it and you approve.

## 14. ⚑ Decisions to confirm

1. Graph queries in memory instead of recursive SQL (4.2).
2. No edge caching of keyed data responses (4.1).
3. Kysely + SQL migrations; npm workspaces (5.1).
4. The whole database design in section 6, especially: negative AH for before-Hijra years, one `scholar_relation` table + the combined `teaching_edge` view, the Tahdheeb al-Kamal raw-plus-typed approach, and dropping the default "Natural" cause.
5. In-memory per-second rate limits on a single instance (6.7).
6. Key format `msk_live_<prefix>_<secret>` and default limits 1,000/day, 10/s (section 9).
7. ID 2's source entries are dropped as corrupt.
