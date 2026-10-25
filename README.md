# AcIntel — Actionable Intelligence for the Abia Control Room

A standalone, premium redesign of the Homeland CSAS admin. Phases 0–6 are built; see **PHASES.md**.
It does **not** call the live Homeland system. `apps/api/src/dataport.ts` is a no-op stub for the Phase 7 handshake.

| Service | Stack | Network |
|---|---|---|
| `web` | Next.js 14 (standalone), recharts, MapLibre GL + OSM | **the only published port** (`WEB_HOST_PORT`, default 3131) |
| `api` | NestJS 10 + Prisma 5, SSE realtime | internal `api:4000` (web proxies `/api/*` to it) |
| `db` | PostgreSQL 16 (+ `pg_trgm`) | internal, volume `pgdata` |
| `redis` | Redis 7 (pub/sub for live push, rate limits) | internal, volume `redisdata` |

**Login:** `admin@acintel.local` / `Passw0rd!23`. Change `SEED_ADMIN_*` before go-live.
Demo controller: `ops@acintel.local` with the same password. All times are shown in **Africa/Lagos (WAT)**.

## 1 · Run anywhere with Docker

```bash
cp .env.example .env            # set POSTGRES_PASSWORD (required) and the SEED_ADMIN_* values
docker compose up -d --build    # http://localhost:3131
docker compose ps               # all four services should report "healthy"
```

On every start the API container runs `prisma migrate deploy`, then an idempotent seed, then the server.
Demo data is created only when the DB is empty. `SEED_DEMO=false` seeds the admin only.
`SEED_RESET=true` wipes the data and reseeds; set it back to `false` straight away.

For dev, also publish db (5433), redis (6379) and api (4000) and force plain-http cookies:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.

## 2 · Deploy on Coolify (Contabo): the single supported path

1. **New Resource → Docker Compose** (Git repo, or upload/extract `acintel-deploy.zip` into a repo). Build pack: *Docker Compose*. Compose file: `/docker-compose.yml`.
2. **Environment variables:** paste `.env.example` into Coolify's env editor and edit it.
   - Required: `POSTGRES_PASSWORD`. Coolify flags it because the compose file uses `${POSTGRES_PASSWORD:?}`.
   - Change `SEED_ADMIN_PASSWORD`.
   - Leave `API_INTERNAL_URL=http://api:4000` and `COOKIE_SECURE=auto`.
3. **Domains:** assign your domain to the **`web`** service only, for example `https://control.example.com:3000`. The `:3000` tells Coolify's proxy which container port to use.
   - Give **no domain to `api`, `db` or `redis`**.
   - The browser only talks to `web`; `web` proxies `/api/*` (including the SSE stream) to `api:4000` over the internal network.
   - If host port 3131 is already taken on the server, set `WEB_HOST_PORT` to something else or delete the `ports:` line under `web`. Coolify's Traefik routes by domain and does not need the host port.
4. **Deploy.** The first build takes about 3–5 min.
   - The API healthcheck allows 60 s for migrate + seed. `web` waits for `api` to be healthy.
   - Then open the domain and log in.
5. **HTTPS:** Coolify/Traefik terminates TLS and sends `X-Forwarded-Proto: https`.
   - With `COOKIE_SECURE=auto`, the session cookie becomes `Secure` automatically.
   - Plain-http access by IP still works.
6. **Backups:** back up the `pgdata` volume, or schedule Coolify's Postgres backup / `pg_dump`. Also back up `uploads` (incident media). Redis holds only transient state.
7. **Updates:** push or redeploy. Migrations apply automatically on start, and data in the volumes is kept.

Realtime note: the SSE route sends `X-Accel-Buffering: no` and `Cache-Control: no-transform`, so Traefik/nginx do not buffer it. No extra proxy config is needed.

### AI assistant (RunPod or any OpenAI-compatible endpoint)
Set the following and redeploy:
- `OPENAI_BASE_URL`, for example `https://api.runpod.ai/v2/<endpoint-id>/openai/v1` or a vLLM pod `https://<pod>-8000.proxy.runpod.net/v1`;
- `OPENAI_API_KEY`;
- `OPENAI_MODEL`: the exact model name the endpoint serves (for RunPod vLLM, the Hugging Face id such as `Qwen/Qwen2.5-7B-Instruct`). If it is wrong, the API picks the first model from `GET /models` and logs a warning.
- `OPENAI_TIMEOUT_MS` (default `120000`): this allows for serverless cold starts.
- `OPENAI_MAX_TOKENS` (default `1024`).

The base URL is normalised. A trailing `/chat/completions` is stripped. A bare `https://api.runpod.ai/v2/<id>` gets `/openai/v1` appended. A missing `/v1` is added. RunPod `IN_QUEUE`/`IN_PROGRESS` jobs are polled until they finish.
- Tool calling works best. Models without it still answer: the API runs the query itself and asks the model to phrase the result.
- Provider failures are logged in the API container as `[AI] …` / `AI provider <status>` lines. The user sees a short "please try again" message.

Without these settings, the assistant answers from the built-in query engine and the rest of the app works normally.
Replies run in the background and arrive over the live stream.

### Maps
The default is MapLibre GL with OpenStreetMap raster tiles (`MAP_TILE_URL`, `MAP_ATTRIBUTION`), or a full vector style via `MAP_STYLE_URL`, such as MapTiler or a self-hosted style.
- For production traffic, use a tile provider or self-hosted tiles. The public OSM tile servers have a usage policy.
- **Google Maps:** Google's tiles cannot simply be put into MapLibre under Google's terms. `GOOGLE_MAPS_API_KEY` is reserved for a future Google JS-API renderer. It is not used today.

## 3 · Run without Docker (npm)

Requires Node 20+, PostgreSQL 14+ (with `pg_trgm` available) and Redis 6+.

```bash
npm ci
export DATABASE_URL=postgresql://USER:PASS@localhost:5432/acintel REDIS_URL=redis://localhost:6379
npm run build -w apps/api && npm run db:migrate && npm run db:seed
PORT=4000 npm run start -w apps/api
# second terminal
API_INTERNAL_URL=http://localhost:4000 npm run dev -w apps/web     # :3000
```

## Layout

```
apps/api   NestJS: auth + roles + login rate limit, records/entity/search (pg_trgm), ops (users, agents, groups,
           categories, admins, incidents, media, alarms, alerts, audit+undo, CSV import), realtime (Redis bus + SSE),
           AI (background tool-calling), dataport.ts (Phase 7 stub)
  prisma/  schema + migrations;  src/seed.ts demo data (17 Abia LGAs)
apps/web   Next.js: login, dashboard, /[section]/[child] lists, maps, analytics, /alerts, /audit, /settings, /e/[id]
```
