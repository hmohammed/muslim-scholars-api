# Muslim Scholars API

A public, read-only REST API over ~25,000 Muslim scholar biographies, teacher–student
networks and classical Arabic source texts, originally compiled by the
Muslim Scholars Database (Arees Institute). See [docs/PLAN.md](docs/PLAN.md).

## Local development

Requires Node 24 (`nvm use`) and Docker.

```sh
cp .env.example .env   # once
npm install
npm run db:up          # Postgres 17 on localhost:5433
npm run db:migrate
npm run dev            # http://localhost:3000/docs
```

`/v1` requires an `X-API-Key` header. Sign in at [http://localhost:3000/portal](http://localhost:3000/portal) to create one. Set `ADMIN_GITHUB_LOGINS` in `.env` to your GitHub username before that sign-in if you want `/admin`. Swagger documents a shared Try it key with a low limit.

| Command | What it does |
|---|---|
| `npm run check` | Type-check, lint and test (what CI runs) |
| `npm test` | Tests against the `msapi_test` database |
| `npm run db:down` | Stop Postgres (data is kept in a Docker volume) |
| `npm run import` | Parse `RAW_HTML_DIR` and replace the local dataset. Writes `import-report.md` |
| `npm run import:fill` | Fill only columns that are still empty and were not edited by hand |

The crawled HTML stays outside this repo. `RAW_HTML_DIR` in `.env` points at it. Reading that folder from WSL is slow when the project lives on the Windows drive; running Node on Windows, or moving the repo into the Linux filesystem, avoids that.

TypeScript runs directly on Node 24 (type stripping), so there is no build step;
`npm run typecheck` only checks types. Code must therefore avoid TypeScript-only
runtime syntax such as `enum` (enforced by `erasableSyntaxOnly`).
