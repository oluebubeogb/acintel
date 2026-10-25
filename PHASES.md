# AcIntel — Phases 0–6 report

_Status: Phases 0–6 are complete and verified locally on 25 Oct 2026. Phase 7 (live Homeland handshake) has not started; `dataport.ts` is still a stub._

## Verification (box has no Docker daemon)
- **API:** `tsc --noEmit` and `nest build` are clean. **Web:** `next build` (standalone) is clean, with the prebuild copying the MapLibre worker.
- **Postgres + Redis:** migrations `init`, `security_alerts` and `phases_1_6` apply, and `prisma migrate diff` shows the schema is in sync.
- **Compose:** `docker compose config -q` passes for `docker-compose.yml` and for the `docker-compose.dev.yml` overlay, using the Compose v2.29 CLI. A missing `POSTGRES_PASSWORD` is rejected as intended. `docker compose up` itself needs a Docker host (Coolify/Contabo).
- **Dockerfile install steps:** `npm ci -w apps/web` and `npm ci -w apps/api` were dry-run from the lockfile.
- **Proxy smoke tests (web :3210 → api :4210):**
  - login over http gives a cookie without `Secure`; with `X-Forwarded-Proto: https` the cookie is `Secure`;
  - SSE through the proxy delivers `hello` then `counts`;
  - multipart media upload works;
  - the login rate limit responds `401 401 429 429` with `LOGIN_MAX_FAILS=3`.
- **Headless Chrome sweep (WebGL via SwiftShader):** every page, with no page errors. The maps rendered 109 agent markers and 150 incident markers. Screenshots are in `screenshots/phase16/`.

## Realtime: push on write (no idle polling)
- **Publishing:** every write path calls `Activity.pushCounts()`. This covers approve/suspend/activate, agent create/assign/import, incidents (dispatch, resolve, fake, media), alarms, alerts, notifications, undo and the simulator.
  - It debounces for 250 ms, recomputes counts once, and publishes `{type:'counts'}` plus `{type:'changed', kinds}` on the Redis channel `acintel:events`.
- **Delivery:** each API instance's SSE `/stream` forwards the events. The browser applies counts directly, without a fetch, and the open list or dashboard reloads only on a relevant `changed`.
- **Measured** on an idle dashboard through the web proxy:
  - a curl approve moved "Pending users" from 68 to 67 in **327 ms**;
  - over 65 s idle, the only requests were reloads triggered by `changed` events; there were **zero `/notifications/counts` polls**.
- **Fallback:**
  - while the stream is healthy, a single heal poll runs every 120 s on visible tabs only;
  - while the stream is down, it polls every `pollSeconds` (10–120) with backoff capped at 300 s;
  - when a hidden tab regains focus, it reconnects and resyncs immediately.

## Phase 1: actions, entities, drill-downs
- **User actions:** approve, suspend and activate, as single or bulk actions, each with a confirm step. Every action writes an audit row, and a toast offers **Undo**.
- **User `/e/[id]` page:** profile, devices, reports, alarms, and a 30-day engagement strip. Clicking a day opens that day's engagement overlay with reports, alarms, logins and admin actions.
- **Generate list:** filters for LGA, status, type, group, period and text, plus CSV export.
- **Devices:** a list page and a device entity page.
- **Dashboard:** the whole KPI card is clickable, with multicolor duotone icons. It opens an overlay table with CSV and "Open as page"; Alarms opens New alarms. Charts have a period filter (7/14/30/90 days).

## Phase 2: agents, groups, admins
- **Groups:** CRUD. **Admins:** CRUD with roles and password reset.
- **Adding agents:** an add-agent form, plus CSV import for agents/users (and optionally groups/categories) with a downloadable template, row validation and an error report.
- **Agent lists:** active, suspended and unassigned lists, assign/unassign group (single or bulk), and an agent entity page.
- **Agent map:** MapLibre with an online overlay (seen within `AGENT_ONLINE_MINUTES`) and hover/click cards.

## Phase 3: incidents
- **Categories:** CRUD.
- **Incident actions:** resolve and mark-fake, with confirm, audit and undo.
- **Incident media:** upload (`MEDIA_MAX_MB`) or attach by URL, with a gallery and delete.
- **Incident map:** MapLibre + OSM with status colours and popups. `MAP_STYLE_URL` / `MAP_TILE_URL` are configurable; the Google notes are in the README.
- **Analytics:** a date range, LGA and category, with charts and CSV. It is deep-linkable through query params.
- **Dispatch hardening:**
  - agency whitelist;
  - idempotent dispatch, which refuses resolved or fake incidents;
  - an audit row;
  - push to all screens.

## Phase 4: alarms, alerts, realtime
- **Alarms:** New, duress and panic lists, resolved one at a time or in bulk, with notes, audit and undo.
- **Security alerts:** send, view and delete. The audience can be all users, LGA(s), user type or group, and the recipient count is previewed before sending.
- **Realtime:** Redis pub/sub + SSE (above). The Alerts notification feed stays separate from Alarms.

## Phase 5: search and AI
- **Search:** `pg_trgm` trigram search across users, agents, incidents, alarms, groups, categories, admins and pages.
  - Results are grouped with origin tags (e.g. "Agents · suspended") and opened with Ctrl+K or `/`.
- **AI:** background tool-calling against an OpenAI-compatible endpoint (RunPod/vLLM).
  - Tools: counts, filtered lists (returned as tables with entity links) and CSV exports (download links).
  - Replies arrive via an SSE `ai.done` event; a 5 s poll runs only if the stream is down.
  - Without credentials, it returns an offline placeholder.

## Phase 6: hardening and deploy
- **Roles v1:**

  | Role | Access |
  |---|---|
  | `superadmin` | everything |
  | `controller` | operations + audit view |
  | `group_admin` | read-only |

  The API enforces these roles on every mutating route, and the UI hides or disables actions accordingly.
- **Audit log page** (`/audit`): filters, links to the affected record, and single or bulk undo for whitelisted actions within 24 h.
- **Login rate limit:** per account (`LOGIN_MAX_FAILS`) and per IP (`LOGIN_MAX_PER_IP`) within `LOGIN_WINDOW_MINUTES`.
- **Production compose:**
  - only `web` is published; `api`, `db` and `redis` are internal;
  - every service has a healthcheck, and `web` waits for `api` to be healthy;
  - migrate + seed run on start;
  - volumes: `pgdata`, `redisdata`, `uploads`.
- **Config and docs:** a complete `.env.example`; `COOKIE_SECURE=auto` with proxy `X-Forwarded-*` forwarding; SSE anti-buffering headers; the README's Coolify path.

## Known gaps / notes
- **Phase 7** (live Homeland read sync + dispatch write-back) is not implemented; `apps/api/src/dataport.ts` is still the no-op seam.
- **Google Maps** is not a drop-in, for licensing reasons. `GOOGLE_MAPS_API_KEY` is reserved. For production, use a proper tile provider or self-hosted tiles rather than tile.openstreetmap.org.
- **`group_admin`** is read-only in v1; it is not yet limited to its own groups.
- **Day overlay:** the "Admin actions" stat can differ slightly from the tab count. The stat counts audit rows by actor; the tab includes rows about the user.
- **AI answer quality** depends on the model you point at. It must support tool calls.
- **Not yet run under a Docker daemon**, because this build box has none. The first `docker compose up` on Coolify is the end-to-end check.
