# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CoTrip — AI-powered collaborative trip planner as a native WeChat Mini Program (TypeScript), its Node.js/Express backend in `server/`, and a Tencent CloudBase HTTP function in `CloudBase/c/` that fronts the LLM. Participants express needs as natural-language comments; an AI layer converts them into structured constraints and maintains one shared executable plan.

The authoritative product spec is `AI_Coexistence_Trip_MiniProgram_V1.md` — read it before implementing any module. `README.md` tracks what is shipped vs. missing (it lags the AI work: it still lists comment persistence as unimplemented). `CHANGELOG.md` covers the route-planning era. `design-qa.md` holds UI/visual QA notes. `AGENTS.md` and `CODEBUDDY.md` carry earlier agent-facing notes; this file supersedes them where they conflict — in particular AGENTS.md still claims the backend persists "users and trip shells only," which is no longer true.

Comments, UI copy, and test assertion messages are largely in Chinese — match that.

## Commands

Three independent npm projects. Root tsconfig excludes `server/`; test output dirs differ (`.test-dist/` vs `dist-test/`). Run their commands separately.

### Mini program (repo root)

- Run/preview: open the repo root in WeChat DevTools (微信开发者工具). TypeScript compiles via its built-in plugin configured in `project.config.json`; there is no CLI build.
- `npm install` — dev deps only (`typescript`, `miniprogram-api-typings`).
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — typecheck, compile to temporary `.test-dist/`, run all tests, delete `.test-dist/`.

### Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env
npm run dev            # ts-node, binds 127.0.0.1:3000
npm run build && npm start
npm run typecheck
npm test               # typecheck + compile to dist-test/ + run server/tests
```

Health check: `GET http://localhost:3000/health`.

`loadConfig()` (`server/src/config/index.ts`) **throws** if `WECHAT_APPID` / `WECHAT_SECRET` / `AUTH_TOKEN_SECRET` are absent, so `npm run dev` needs a real `.env`. Server tests construct repositories and services directly and never call `loadConfig()`/`createApp()`, so `npm test` works without one.

AI env vars are all optional — absent config degrades explicitly rather than failing startup (see **AI provider selection**).

### AI gateway (`CloudBase/c/`)

Plain JavaScript (no TypeScript), deployed as a CloudBase HTTP function.

```bash
cd CloudBase/c
npm install
npm test          # node tests/run-tests.js
npm run smoke     # node tests/smoke.js
npm start         # local server on PORT (default 9000)
```

Only `index.js`, `package.json`, `scf_bootstrap`, `cloudbaserc.json`, `lib/`, and `tests/` are tracked — `node_modules/`, `cloudbase-template*.json`, both `README_*.md`, and `c.zip` are git-ignored, so don't cite that README as repo documentation.

## Tests

There is no test framework — tests are plain files with hand-rolled assertions, and the suites use **different runner conventions**.

**Root (`tests/`)** — two styles coexist in `tests/run-tests.ts`:
- Side-effect files (`constraint-parser`, `room-code`, `trip-share`, `real-comment-planning`, `coordination-ui`, …) run their assertions at import time via a local `assert()` helper.
- Async files export `run*Tests()`, which `main()` awaits.

A new root test must be registered in `tests/run-tests.ts` in the matching style. To run one in isolation:

```bash
npx tsc --outDir .test-dist --module commonjs
node .test-dist/tests/constraint-parser.test.js                              # side-effect style
node -e "require('./.test-dist/tests/join-flow.test').runJoinFlowTests()"     # run*Tests style
```

**Backend (`server/tests/`)** — every file exports `run*Tests()` and imports the shared `record()` helper from `./run-tests`; register new files in `server/tests/run-tests.ts`. Note the circular import: `run-tests.ts` calls `main()` at module top level, so importing any single compiled server test file pulls in the runner and executes the **entire** suite. Isolating one backend test is not practical — run `npm test` and read the per-case `✓`/`✗` lines.

**Gateway (`CloudBase/c/tests/`)** — plain `.js`, registered in `tests/run-tests.js`. `smoke.js` is a separate manual entry point.

`contracts/ai-comment-analysis-fixtures.json` is the shared AI-contract fixture (valid + invalid analysis payloads), consumed by `server/tests/ai-comment-contract.test.ts`. When you change the comment-analysis schema, update the fixture and both validators (server `ai-comment-validation.ts` and gateway `lib/ai-response-parser.js`) together.

## Architecture

Three layers, strictly separated. The trust boundary is the CoTrip server: the gateway is **not** a trust boundary and its validation is deliberately duplicated (and superseded) server-side.

```
Mini Program → CoTrip Server → CloudBase HTTP Function → hunyuan-v3 (hy3)
                     ↑ authoritative validation, persistence, permissions
```

### Mini program (root)

Pages/components follow the four-file pattern (`.ts/.json/.wxml/.wxss`) under `pages/<feature>/` and `components/<kebab-name>/`. The tabBar is custom (`custom-tab-bar/`, declared in `app.json`).

- `types/` — domain models (Trip, Plan, Event, Constraint, Comment, Coordination, Time, Location, Price, Route…).
- `core/` — pure planning logic, **verified zero `wx.*` references**, fully unit-testable: `constraint-parser` → `ConstraintStore` → `conflict-detector` → `plan-reconciler`, orchestrated by `PlanningEngine.processComments()`, with `candidate-ranker` scoring options and `constraint-evaluator` scoring a plan against constraints. `core/index.ts` is the public surface.
- `services/` — one interface per capability, implementations in `services/mock/`, `services/real/`, provider adapters in `services/providers/`.
- `utils/` — page-facing flow helpers (`join-flow`, `trip-share`, `room-code`, `demo-trip`, `comment-sync`, `real-comment-planning`, `coordination-ui`, `personal-route`, `guangzhou-metro`…). `mock/` — deterministic fixtures.

**`services/index.ts` is the single wiring point, and it is static — there is no `mock | real` mode switch.** Do not reintroduce one, and do not describe `config/auth.ts` as having a `mode` field:

- `authService`, `tripService`, `commentService`, `coordinationService` → **always Real**. Backend failure surfaces an explicit error state; **never** silently falls back to Mock.
- `routeOptionService` → **Real** (`RealRouteOptionService`, Tencent direction v1). Real trips must first clear the "我的推荐" gate in `utils/personal-route.ts`: the plan's first location must exist (missing → 「行程未生成」), then the user explicitly picks a departure point in-panel (saved place or map pick) before any request fires. The origin comes from the user's saved departure places (local storage, private), never from device location. `DisabledRouteOptionService` is retained purely as a kill switch.
- `demoAIService` (note the name — it is **not** `aiService`), `mapService`, `placeService`, `notificationService`, `externalActionService` → still Mock. The real comment AI lives on the server and never references `demoAIService`.

`config/auth.ts` holds only `baseUrl`, storage keys, and `enableDemoTrip`.

### Demo trip vs. real trip — the split that trips people up

`utils/demo-trip.ts` provides one clearly-labeled local sample trip rendered alongside real trips. It is **not** a fallback and bypasses the service contracts entirely. `pages/trip-detail/trip-detail.ts` branches on `isDemoTripId(tripId)` at every AI/network touchpoint, and the two paths must stay strictly isolated:

| | Demo trip | Real trip |
|---|---|---|
| Plan computation | local `PlanningEngine.processComments()` (rule parser) | `evaluateRealCommentPlan()` — consumes only server-verified `comment.aiAnalysis`; **never** runs the rule parser |
| Coordination | `MockCoordinationService` | `RealCoordinationService` → server evaluator |
| Routes | `MockRouteOptionService` (fixed Guangzhou fixture, never reaches Tencent) | `RealRouteOptionService` → Tencent |

So `core/`'s rule-based `constraint-parser` is now **demo-only** for planning purposes. Real constraint extraction is the server's job. Don't "fix" a real-trip parsing gap by wiring the local parser back in.

### The AI pipeline

Three distinct AI call sites, each with its own contract, validator, and degradation path. All of them return structured data, and all of them fail *visibly* rather than fabricating.

**1. PREPROCESS — at trip creation.** `RealTripService.createTrip()` → `TripPreprocessAIService` → `validatePreprocessEnvelope()` → `buildTripAIContext()` → `trip.aiContext`. Semantic hard rule: preprocess only extracts intent/constraints and **must never generate an itinerary** — a valid envelope has `trip === null` and `decision.canGenerateTrip === false`. AI unavailable or invalid → the trip is still created, just without `aiContext`.

**2. Comment analysis — on every comment.** `CommentService.addComment()` → `AICommentService.analyzeComment()` → `validateAICommentAnalysis()` (strict: exact key sets, enum membership, ISO-8601 datetimes, ≤8 constraints, intent/constraint-count consistency) → persisted onto the comment → `ConstraintLedgerService.persistFromAnalysis()` materializes `TripConstraint` records.

The persistence order in `analyzeAndPersist` is deliberate and load-bearing: **comment first, ledger second.** The analysis is the single replayable authoritative source, so it must survive a ledger failure. Consequences encoded there:
- ledger returns empty (AI claimed constraints, none normalizable) → comment marked `unresolved`, `aiAnalysis` retained for audit.
- ledger write throws → comment stays `accepted` with `aiAnalysis`; lazy backfill self-heals later. Never marked "fully processed."
- AI throws → comment persisted as `unresolved`; raw text always preserved for re-parsing.

**3. Coordination — on demand.** `POST /trips/:id/coordination/analyze` → server loads authoritative constraints itself → deterministic `TripConstraintEvaluator` → `TripCoordinationAIService` → `validateCoordinationProposal()`. AI failure or invalid schema → deterministic state is returned unchanged with `coordinationUnavailable: true` and **no** proposal. The evaluator is pure logic; AI only explains, never recomputes the numbers.

**AI provider selection** (`createApp()` in `server/src/app.ts`) — note the asymmetry:
- Preprocess and coordination check `AI_GATEWAY_URL` + `AI_GATEWAY_SECRET` only. They ignore `AI_PROVIDER` entirely; without gateway config they get `Unavailable*` services.
- Comment analysis honors `AI_PROVIDER`: `cloudbase_gateway` → gateway (or `Unavailable` if the gateway config is incomplete — never a silent fallback to OpenAI); otherwise OpenAI-compatible if `AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL` are all set; otherwise `Unavailable`.

The `Unavailable*` classes exist so that "not configured" is an explicit rejected promise, not a rule-based impersonation of an LLM. There is no server-side rule fallback.

**Constraint Ledger semantics** (`constraint-ledger-service.ts`) — subtle, heavily commented, easy to break:
- *Conservative supersession*: a new constraint with the same `user + type + scope` records `supersedesConstraintId`, but the old one stays `ACTIVE` until a member confirms. HARD constraints must never be silently relaxed, so the evaluator keeps intersecting both.
- *Source reconciliation*: re-analyzing the same comment with changed output marks that comment's old constraints `SUPERSEDED` (history kept, count doesn't balloon) and writes the new set. Identical output is a no-op — the operation is idempotent by `sourceCommentId`.
- *Lazy backfill*: `backfillFromComments()` materializes legacy persisted `aiAnalysis` into the ledger. It is idempotent and **never calls the AI or spends tokens**. `TripCoordinationService` runs it before every read and analyze; failures are swallowed and retried next call.
- Drafts that can't be deterministically normalized are skipped, never guessed. AI field names differ from ledger field names (`availableAfter`/`availableUntil` ISO → `after`/`until` as `HH:mm` wall-clock in the trip timezone); that mapping lives in `normalizeConstraintValue`.

**Privacy in AI input**: `buildAIInput()` strips all identity before anything leaves the server — participants become `成员A`/`成员B` labels, and constraints lose `id`/`tripId`/`userId`/`sourceCommentId`/timestamps.

### What is actually persisted

The backend persists **four** stores as separate JSON files in `server/data/` (git-ignored): `users.json`, `trips.json`, `comments.json`, `constraints.json`.

Still client-side / not implemented:
- **`Trip.currentPlan` is typed `unknown` and never written by the server.** The computed Plan lives in page state and is lost on reload. The server only reads it as AI input.
- **`Trip.constraintIds` is a permanently empty placeholder.** Constraints are keyed by `tripId` in the constraint repository — query `ConstraintRepository.listByTrip()`, never that array. (`Trip.commentIds` *is* maintained, but only as a best-effort redundant index; the comment repository is authoritative and the list falls back to it.)
- **Real-time sync / WebSocket is unimplemented.** Comments refresh by explicit fetch on show, not push. `utils/comment-sync.ts` handles optimistic-insert + server-confirmation merge: dedupe by `comment.id`, drop a `temp_` optimistic entry when the server has a confirmed one with the same `(userId, rawText)`, sort by `createdAt`.

### Backend (`server/src/`)

`routes/` → `services/` → `repositories/`, assembled by `createApp()` in `server/src/app.ts` (constructor injection; `app.listen` only under `require.main === module`, which keeps it importable from tests).

Routers are all mounted on `/trips` — `tripRouter`, `commentRouter`, `coordinationRouter`. This works because `tripRouter`'s `/:id` matches a single segment only. `/trips/join-preview` must stay declared before `/:id` or it gets swallowed as a trip id.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | |
| POST/GET/PATCH | `/auth/login`, `/auth/profile` | |
| POST/GET | `/trips`, `/trips?status=…`, `/trips/:id` | |
| POST | `/trips/:id/complete` | creator-only, idempotent, 409 on illegal transition |
| DELETE | `/trips/:id` | hard delete, creator-only; returns `{ok:true}`, not 204 |
| GET | `/trips/join-preview?roomCode=` | public, minimal projection |
| POST | `/trips/join` | Bearer, idempotent |
| GET/POST | `/trips/:id/comments` | member-only; POST appends |
| GET | `/trips/:id/constraints` | member-only, read-only ledger |
| GET | `/trips/:id/coordination` | deterministic only, no AI |
| POST | `/trips/:id/coordination/analyze` | deterministic + AI proposal |

JSON repositories write atomically (temp file + `rename`). `JsonTripRepository` loads the whole store into memory at construction; `JsonCommentRepository` does a synchronous read-modify-write per `create` so concurrent appends serialize on Node's single thread and never last-write-wins. All of this is **single-process only** — concurrent server instances over one data file will clobber each other. Room-code uniqueness is re-checked at the commit point (throwing `ROOM_CODE_CONFLICT` for the service to retry) because check-then-write would race. Legacy trips missing a `roomCode` are backfilled on load, preserving all other fields.

Auth flow: `wx.login` code → WeChat `code2Session` → openid resolved server-side → CoTrip user + HMAC token. `requireAuth` parses `Authorization: Bearer <token>` and injects `req.userId`. Errors are uniformly `{ error: { code, message } }`.

Room codes are 7 chars, uppercase, from a confusable-free alphabet (no `0/O`, `1/I/L`), **server-generated only** — never derive one client-side from tripId or a timestamp.

**Security boundaries (do not break):** `WECHAT_SECRET`/`session_key`/`openid` never leave the server; the client holds only the CoTrip token + userId; business code uses `User.id`, never openid; `creatorId`/`participantIds` and comment authorship come only from the validated token — client-submitted identity fields are ignored. Coordination never trusts client-submitted constraints; the server loads them itself. `AI_API_KEY` and `AI_GATEWAY_SECRET` live only in `server/.env`; the gateway secret must match the cloud function's `COTRIP_AI_GATEWAY_SECRET` and is never logged. `config/tencent-map.ts` may hold only client-public config, and ships a `YOUR_TENCENT_MAP_KEY` placeholder (`isTencentMapConfigured()` gates real calls; unconfigured shows "暂未配置地图服务" rather than fake data).

## Product invariants

These span every feature and come from the spec:

1. **AI outputs structured data, never display text.** Events/constraints/plans/proposals are objects; the frontend renders UI from data.
2. **AI never fabricates real-world facts** (venues, prices, ratings, routes). Only provider adapters (`services/providers/`, e.g. Tencent Map) supply verified entities. Routes come from map services, not the LLM. Provider returns 2 routes → show 2; never pad to a nicer number. Unknown fare → hide it, never show a placeholder.
3. **Structured values, never strings**: Time is ISO-8601 with timezone (`Asia/Shanghai`), Location has id/name/lat-lng/address, Price has amount/min/max/currency/unit. Comments always preserve raw user text.
4. **HARD vs SOFT constraints**: HARD (time windows, budget max, fixed district) must never be silently violated; unsatisfiable HARD conflicts surface an explicit Conflict — participants decide. Budget constraints in incompatible currency/unit are not merged (`BUDGET_UNIT_MISMATCH`) rather than approximated.
5. **Suggested Plan vs Current Plan**: major changes (venue swap, time shift, region change, budget increase) go through suggestion → confirmation; minor adjustments auto-apply. AI coordination output is a *proposal*, never the committed plan.
6. **Shared plan + personal route**: one trip, two views. Personal departure locations stay private and only feed that user's route.
7. **Trip states**: `DRAFT → ACTIVE → COMPLETED` (+ `CANCELLED`). COMPLETED is a frozen snapshot with all editing removed. Creator-only powers: invites, member removal, cancel, complete, delete. Completion is idempotent; illegal transitions return 409.
8. **Graceful degradation**: keep last good plan, keep unparsed comments for re-parsing, hide navigation if maps fail, never fabricate data. Every AI failure has a named visible state (`unresolved`, `coordinationUnavailable`, missing `aiContext`) — none of them is a silent rule-based substitute.
9. **V1 scope is frozen**: no AI chat page, social systems, albums, accounting, check-ins, points, content community, or AI persona. Test: 大家负责表达想法，AI 负责把想法变成共同计划。

## Conventions

- Strict TypeScript (`strict`, `noImplicitAny`, `strictNullChecks`); do not bypass with `any`. Path alias `@/*` maps to the repo root. (`CloudBase/c/` is the exception — plain JS, CommonJS, no build step.)
- Two-space indent, single quotes, semicolons. Kebab-case files/dirs, PascalCase types, camelCase functions.
- Business rules live in `core/` or `services/`, never page handlers.
- Third-party and AI response shapes are isolated behind ViewModels (e.g. `RouteOption`, `CoordinationVM`) rather than reaching WXML directly.
- The heavy `// REVIEW n` comments in the server AI services record specific production-readiness fixes with their rationale. Read them before changing that logic — several encode non-obvious ordering or conservatism requirements.
- Commits follow Conventional Commits, often scoped: `feat(core): ...`, `feat(types): ...`, `docs: ...`.
- Never commit API keys, user data, `server/data/*.json`, or a real AppID in `project.config.json` (it ships `touristappid`).
