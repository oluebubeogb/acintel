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

## UI polish (Coolify feedback, Oct 2026)
- **Shell:** web port defaults to `3131` (`WEB_HOST_PORT`); global search ~1.25× wider (5:3 flex share vs the spacer, cap 800px); calmer bell/badge/clock spacing; no live/badge dots; soft alert chime.
- **Nav:** the sub-pane opens directly under the clicked tile's row; 2 tile columns by default, 3 at ≥1600px and on mobile (≤900px); no chevrons.
- **Look:** solid calm-blue buttons, bold blue links, Title Case (non-uppercase) labels and headers, mini colour icons beside small labels; PageHead shows only the title + actions (no crumbs/subtitle, no page-count line); tooltips sit above filter rows; modals sit above hovered cards.
- **Tables:** single-table pages paginate instead of scrolling inside the card; multi-table pages (entity detail, drills) keep the inner scroll.
- **Audit:** short human-readable actions ("Dispatched incident", not `incident.dispatch`) with an area chip.
- **Alarms:** Duress/Panic lists exclude items that are still new (they live under Alarms › New).
- **Agents:** detail mirrors the user card (KPI cards with drill-down, engagement, tables); the form starts with Government Tag, then First/Last Name, Email is required, Device is read-only. Migration `20261025120000_ui_polish_agents` renames `nin` → `tag`, adds `firstName`/`lastName` (backfilled from `name`) and the `AgentTask` table, and remaps panic/duress notification targets to `alarms.new`.
- **Analytics:** dashboard-style KPI cards; each drills into a modal with CSV and "Open as Page" (generic `/records?kind=…` page, also used by the dashboard and entity drills).
- **AI assistant:** helper texts removed and the FAB hides while the panel is open (panel 26px from the bottom). Provider fixes for RunPod and other OpenAI-compatible endpoints: base-URL normalisation, RunPod queue polling, `/models` auto-discovery, retries on 429/5xx, `<think>` stripping, and a no-tools retry when a reply comes back empty. Errors are logged as `[AI]` and the user sees a short retry message instead of the old "offline mode" text. New env vars: `OPENAI_TIMEOUT_MS` (120000) and `OPENAI_MAX_TOKENS` (1024).

## UI polish 2 (sources, vigilante, AI titles — Oct 2026)
- **Day overlay** ("Engagements for the day"): colour-icon stat cards; the Reports / Alarms / New Users / New Agents / Admin Actions cards are the selector (no focus card, no tabs), and User Logins / Dispatches are static. The Admin Actions column no longer leaks into other tables, and admins show by **name**, with the email underneath and in a tooltip (audit tables and the audit actor filter too). The Admin Actions count now equals the rows listed.
- **Incident lists:**
  - The Actions column opens with a green **Agent** button (Send to Vigilante), followed by a white **Dispatch** button with a blue icon, then Acted, Resolve and Fake.
  - The bulk bar order is "N selected" → Dispatch → Acted → Resolve → Fake. Bulk dispatch uses `POST /incidents/dispatch`.
  - Confirm and dispatch overlays list incidents line by line: 5 shown with "Show N more", one clipped line each (84 chars).
  - The **Report** column shows the AI title, with a local fallback.
  - The reporter has an **Agent / User / Call Centre / ECC** tag.
  - A source filter is available on every report list.
- **Sources:** `Incident.source` (`user | agent | call_centre | ecc`, default `user`) plus `agentReporterId`.
  - New nav pages **From Users / From Agents / Call Centre / ECC** sit under Incident Reports. Each has live per-source cards (`GET /reports/sources`).
  - The simulator and demo seed generate a source mix. The seed backfills the old placeholder "reported around/near" texts with realistic narratives; real data is not touched.
- **AI titles and summaries:** `IncidentAiWorker` (`apps/api/src/incident-text.ts`) fills `aiTitle` / `aiSummary` in the background when `OPENAI_*` is set. It runs every `INCIDENT_AI_INTERVAL_MS` (60000), and `INCIDENT_AI=false` turns it off. Without AI, a local title and summary are derived from the text. `POST /incidents/:id/ai` regenerates on demand (audited).
- **Incident page:**
  - Under the map, a two-column section: AI Summary on the left (narrower), and the reporter's original report on the right (wider), with the reporter link and source tag.
  - The header has **Send to Vigilante** (green) and Dispatch (blue).
  - New "Vigilantes Sent" table; sender names are shown, not emails.
- **Send to Vigilante overlay** (from the table row or the incident page):
  - A map with a radius ring: 2 / 4 / 8 / 15 km, default 4 km.
  - Agent cards show name, phone, agency, LGA, Gov Tag, onboarded, last login, online dot, distance (N/A without a location), "already sent" state, and a Map button that flies to the agent.
  - The admin can set the purpose (verify / confirm / resolve) and add a note, then select agents and send.
  - API endpoints: `GET /incidents/:id/nearby-agents?radius=` (haversine; agents without coordinates in the same LGA are listed as N/A) and `POST /incidents/:id/vigilante`.
  - On send, the API creates or re-sends `AgentTask` rows with `purpose` and `note`. Each send is audited as `incident.vigilante`, triggers an in-app notification, and pushes live `agents` / `reports` updates. It also calls `DataPort.pushVigilante`, which is a no-op until Phase 7.
  - Flat colours, no gradients.
- **Agent page:** new "Sent Reports" card, which drills into the reports filed by that agent.
- **Analytics:** a Source filter, "By Source" drill cards (count, share, open/resolved/fake), an "Outcome by Source" stacked chart, and source rows in the CSV pack.
- **Migration:** `20261025150000_sources_vigilante`.
- **Screenshots:** `screenshots/polish2/`.

## Known gaps / notes
- **Phase 7** (live Homeland read sync + dispatch write-back) is not implemented; `apps/api/src/dataport.ts` is still the no-op seam.
- **Google Maps** is not a drop-in, for licensing reasons. `GOOGLE_MAPS_API_KEY` is reserved. For production, use a proper tile provider or self-hosted tiles rather than tile.openstreetmap.org.
- **`group_admin`** is read-only in v1; it is not yet limited to its own groups.
- **Send to Vigilante** is per incident; there is no bulk (multi-incident) vigilante send yet. The agent mobile push is the `DataPort.pushVigilante` no-op until Phase 7.
- **AI answer quality** depends on the model you point at. Tool calls give the best answers; models without tool support fall back to a plain reply built from engine data.
- **Not yet run under a Docker daemon**, because this build box has none. The first `docker compose up` on Coolify is the end-to-end check.

## UI polish 3
- **One active-card style.** New shared `.card-select` / `.card-select.is-active` pattern in `globals.css` (accent via `--acc`): a 1px hairline when idle; when active, a 2px accent ring, a faint accent tint and a soft accent glow. It is used by the nav parent tiles (tone → `--acc`), the day-overlay KPI cards (each card's own accent), and the report-source cards on the From* pages and Analytics. The one-off `.day-card.on` and `.src-card.on` rules were removed.
- **Acted Upon list.** No Send to Vigilante action; Dispatch, Resolve and Fake behave as before. Vigilante stays on New, Dispatched, the source pages and the incident page.
- **From* pages** (users / agents / call-centre / ecc):
  - A new **Status** filter (New, Dispatched, Acted Upon, Resolved) feeds the list query.
  - `GET /reports/sources` now accepts `status` and `category` as well as period, from/to and lga. The source cards refetch on every filter change, so the totals and sub-lines (new · open · resolved · today) reflect the filtered set.
  - The active card also follows the table search and column filter (counts come from the visible rows) and shows a "N marked" pill when rows are ticked.
  - Clicking a card switches source and keeps the filters in the URL.

## AI switches (Settings → AI)
- New site prefs, all default **on** so behaviour is unchanged when unset. Defined in `apps/api/src/ai-flags.ts` and merged into `SITE_DEFAULTS`:
  - `aiEnabled` — master switch;
  - `aiIncidentText` — Report Titles & Summaries (the `IncidentAiWorker`);
  - `aiChat` — Control Room Chat (AcIntel Assist);
  - `aiRegenerate` — On-Demand Regenerate (`POST /incidents/:id/ai`).
- How the switches are read:
  - read from the DB with a cache of at most 3 seconds, and the cache is cleared on every site `PUT /prefs`, so Pause and Start take effect without an API restart;
  - site scope only (admin-scope copies are ignored);
  - values are coerced to booleans;
  - saves are already audited under `settings.site`.
- **Worker:** `run()` and `generate()` skip the LLM when the feature is paused; local titles still show. `INCIDENT_AI=false` is still a hard off for the worker.
- **Chat:** when paused, the provider is never called. The offline query engine still answers count, list and CSV questions; anything else gets a short "AI chat is paused in Settings → AI" reply (`meta.paused`).
- **Regenerate:** returns 400 "On-Demand Regenerate is paused in Settings → AI…" when paused, and the incident page disables the button with a tooltip.
- **`GET /ai/status`** now returns `flags` plus `features.{aiIncidentText,aiChat,aiRegenerate}.{on,running[,envOff]}`.
- **Settings AI card:**
  - shows whether the provider is configured (with a hint that no credits are used until `OPENAI_*` is set);
  - has the master switch plus three feature switches, superadmin only;
  - shows a chip per feature: Running / Paused / Idle · No Keys / Off (Env).
- **AcIntel Assist panel:** shows a "Paused" chip and a short paused notice instead of the usual intro.

## UI polish 4 (batch 5 + steering 1–3)
- **Migrations:** `20261026020000_reporter_details` (Call Centre / ECC caller + anonymous reporter fields), `20261026030000_ai_usage` (`AiUsage` log of every LLM call), `20261026040000_chats` (`ChatThread`, `ChatMessage`).
- **Batch 5:** Homeland-leaning source colours; Call Centre / ECC callers and anonymous reports; view-only incident media; alert-sound fix; Reports › Analytics removed (Analytics lives under Dashboard); login tagline with hyphen plus animated stat icons; AI CSV answers no longer carry a "Download link".
- **Steering 1:** AI chat sessions get 3–7 word titles (LLM when available, local rules otherwise) pushed live via SSE `ai.title`; Settings tooltips (`InfoTip`); superadmin **AI Usage** page at `/settings/ai-usage` (`GET /ai/usage`); Add Agent hints moved into label tooltips.
- **Steering 2:** login footer "Sessions expire after 12 hours · times shown in Africa/Lagos" removed.
- **Steering 3 — Nav:** Settings removed from the sidebar foot (top bar + user menu only). A **Chats** icon sits before the bell with a live unread badge (`counts.chats`), visible to `ops` roles.
- **Steering 3 — Chats (agents ↔ control room):**
  - One shared desk thread per agent (`ChatThread.agentId` unique). Desk = superadmin + controller (`ops` perm); group_admin has no access; agents do not message each other.
  - Unread = agent messages the desk has not opened; opening or replying marks them read. Admin messages show **Seen** once the agents' app acks the feed.
  - Attachments: photos (JPG/PNG/WebP/GIF/HEIC) and voice notes (WebM/OGG/MP3/M4A/AAC/WAV/3GP/AMR), stored in `UPLOAD_DIR/chats/<thread>/<message>.<ext>`, max `CHAT_MAX_UPLOAD_MB` (25). Served with Range support.
  - Live: `chat.message` / `chat.read` on the Redis bus → SSE → `acintel:chat` window event; counts are pushed on every write.
  - Web: `/chats` (list + thread, search over people and message text with highlighted snippets, All/Unread, New Message picker, Lagos day separators and times, image lightbox, voice player, MediaRecorder voice notes, paste-to-send photos, mobile single pane). Agent page has **Send Message**.
  - Seed creates 4 demo threads when none exist; `SEED_RESET` clears chats.
  - Routes (desk, `ops`): `GET /chats?q=&filter=unread`, `GET /chats/people?q=`, `POST /chats/start {agentId}`, `GET /chats/:id`, `POST /chats/:id/read`, `POST /chats/:id/messages {body}`, `POST /chats/:id/attachments` (multipart `file`, `body?`, `durationSec?`), `GET /chats/files/:messageId`.
  - Routes (agents' app, public + `x-chat-key: $CHAT_INBOUND_KEY`, 404 when unset): `POST /chats/inbound` (`agent` = publicId / legacy id / phone, `body?`, `file?`), `GET /chats/agent-feed?agent=&since=&ack=1`, `GET /chats/agent-files/:messageId`.
  - Env: `CHAT_INBOUND_KEY`, `CHAT_DEMO_REPLIES` (empty follows `SIMULATE_ACTIVITY`), `CHAT_MAX_UPLOAD_MB`.
- Times: en-GB 12-hour formatting now uses `hourCycle: 'h12'` (fixes "00:43 pm").
- Screenshots: `screenshots/polish4/01–25`.
