# Base44 sandbox notes — PoliticData

## What this app is
Python 3.12 standard library only — no pip dependencies, no build step. `politicdata/app.py`
is the whole backend and also serves the frontend (`index.html`, `app.js`, `style.css`,
`scanner.js`) from disk, so there is a single origin and no CORS/proxy wiring to maintain.

## Run it
```bash
docker compose -f docker-compose.base44.yml up -d --build
docker compose -f docker-compose.base44.yml ps          # wait for (healthy)
curl -s http://localhost:3000/health                    # {"status": "ok", "database": "sqlite"}
```

## Non-obvious things
- **No live reload for Python.** Static files are read from disk on every request, so
  frontend edits appear on refresh; after editing `app.py` run
  `docker compose -f docker-compose.base44.yml restart app`.
- **Static routes are explicit** in `Handler.do_GET` and are listed *before* the auth gate.
  A new asset must get its own route (served from `BASE`) or it returns 401 to the login page.
- **SQLite lives outside the repo** at `/data/politicdata.db` on the named volume
  `politicdata-data`, so the working tree stays clean and data survives restarts.
- **The admin user is created only once**, the first time the `users` table is empty, from
  `POLITICDATA_ADMIN` / `POLITICDATA_PASSWORD`. Changing the password later has no effect on
  an existing database — to apply a new one, drop the dev volume
  (`docker compose -f docker-compose.base44.yml down -v`), which erases local records.
- **Data seeds itself on every start**: `restore_official_elections()` upserts the public TSE
  file `data/politicdata_sao_luis_2024_CORRIGIDO.csv` (2173 rows, idempotent), and the IBGE
  census mesh is served at `/setores-ibge.geojson` from `data/`.
- **PostgreSQL is optional and not used here**: it needs `DATABASE_URL` *and*
  `POLITICDATA_USE_POSTGRES=1`. `politicdata/pg_adapter.py` connects with `sslmode=require`,
  so it only works against a TLS-enabled host (e.g. Neon) — not a local Postgres.
- `X-Frame-Options: DENY` and a CSP are set on every response; the preview proxy adjusts the
  frame headers. Do not remove them to embed the preview.

## Sandbox overrides (why they exist)
`POLITICDATA_HOST=0.0.0.0` (the app defaults to `127.0.0.1` off Render), host port `3000`
mapped to the app's `8765`, and `POLITICDATA_DB=/data/politicdata.db`. No code path is gated
on `BASE44_PREVIEW_MODE`; the variable is only passed through to the container.

## Verify a change
Log in at `/` with the credentials in `.env.base44-defaults` (dev-only placeholders, overridden
by `/run/base44/app.env`), then exercise the changed page; `GET /health` checks the database and
is what the compose healthcheck probes.
