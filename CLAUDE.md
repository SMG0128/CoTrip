# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CoTrip — AI-powered collaborative trip planner as a native WeChat Mini Program (TypeScript), plus its Node.js/Express backend in `server/`. Participants express needs as natural-language comments; an AI layer converts them into structured constraints and maintains one shared executable plan.

The authoritative product spec is `AI_Coexistence_Trip_MiniProgram_V1.md` — read it before implementing any module. `README.md` tracks what is actually shipped vs. still missing. `AGENTS.md` and `CODEBUDDY.md` carry earlier agent-facing notes; this file supersedes them where they conflict.

Comments, UI copy, and test assertion messages are largely in Chinese — match that.

## Commands

### Mini program (repo root)

- Run/preview: open the repo root in WeChat DevTools (微信开发者工具). TypeScript compiles via its built-in plugin configured in `project.config.json`; there is no CLI build.
- `npm install` — dev deps only (`typescript`, `miniprogram-api-typings`).
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — typecheck, compile to temporary `.test-dist/`, run all tests, delete `.test-dist/`.

### Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env   # WECHAT_APPID, WECHAT_SECRET, AUTH_TOKEN_SECRET, PORT
npm run dev            # ts-node, binds 127.0.0.1:3000
npm run build && npm start
npm run typecheck
npm test               # typecheck + compile to dist-test/ + run server/tests
```

Health check: `GET http://localhost:3000/health`.

`loadConfig()` (`server/src/config/index.ts`) **throws** if `WECHAT_APPID` / `WECHAT_SECRET` / `AUTH_TOKEN_SECRET` are absent, so `npm run dev` needs a real `.env`. Server tests construct repositories and services directly and never call `loadConfig()`/`createApp()`, so `npm test` works without one.

Root and `server/` are independent TypeScript projects (root tsconfig excludes `server/`; test output dirs differ — `.test-dist/` vs `dist-test/`). Run their commands separately.

## Tests

There is no test framework — tests are plain `.ts` files with hand-rolled assertions, and the two suites use **different runner conventions**.

**Root (`tests/`)** — two styles coexist in `tests/run-tests.ts`:
- Side-effect files (`constraint-parser`, `room-code`, `trip-share`, …) run their assertions at import time via a local `assert()` helper.
- Async files export `run*Tests()`, which `main()` awaits.

A new root test must be registered in `tests/run-tests.ts` in the matching style. To run one in isolation:

```bash
npx tsc --outDir .test-dist --module commonjs
node .test-dist/tests/constraint-parser.test.js                              # side-effect style
node -e "require('./.test-dist/tests/join-flow.test').runJoinFlowTests()"     # run*Tests style
```

**Backend (`server/tests/`)** — every file exports `run*Tests()` and imports the shared `record()` helper from `./run-tests`; register new files in `server/tests/run-tests.ts`. Note the circular import: `run-tests.ts` calls `main()` at module top level, so importing any single compiled server test file pulls in the runner and executes the **entire** suite. Isolating one backend test is not practical — run `npm test` and read the per-case `✓`/`✗` lines.

## Architecture

Two layers, strictly separated.

### Mini program (root)

Pages/components follow the four-file pattern (`.ts/.json/.wxml/.wxss`) under `pages/<feature>/` and `components/<kebab-name>/`. The tabBar is custom (`custom-tab-bar/`, declared in `app.json`).

- `types/` — domain models (Trip, Plan, Event, Constraint, Comment, Time, Location, Price, Route…).
- `core/` — pure planning logic, **verified zero `wx.*` references**, fully unit-testable: `constraint-parser` → `ConstraintStore` → `conflict-detector` → `plan-reconciler`, orchestrated by `PlanningEngine.processComments()` (`core/planning-engine.ts`), with `candidate-ranker` scoring options. `core/index.ts` is the public surface.
- `services/` — one interface per capability, implementations in `services/mock/`, `services/real/`, and provider adapters in `services/providers/`.
- `utils/` — page-facing flow helpers (`join-flow`, `trip-share`, `room-code`, `demo-trip`, `route-options-ui`, `guangzhou-metro`…). `mock/` — deterministic fixtures.

**`services/index.ts` is the single wiring point, and it is now static — there is no `mock | real` mode switch.** Do not reintroduce one, and do not describe `config/auth.ts` as having a `mode` field:

- `authService`, `tripService` → **always Real** (`RealAuthService`, `RealTripService`). Backend failure surfaces an explicit error state; **never** silently falls back to Mock.
- `routeOptionService` → **Real** (`RealRouteOptionService`, Tencent direction v1 — enabled). Real trips must first clear the "我的推荐" gate in `utils/personal-route.ts`: **personal departure place → first plan location; if either is missing, no request is made** (missing departure → 「请设置出发地点」, missing first location → 「行程未生成」). The origin comes from the user's saved departure places (local storage, private), not from device location. The built-in demo trip is **explicitly exempt from that gate** so it stays usable out of the box — it uses `MockRouteOptionService` with the fixed Guangzhou fixture and never reaches Tencent. `DisabledRouteOptionService` is retained purely as a kill switch.
- `aiService`, `mapService`, `placeService`, `notificationService`, `externalActionService` → still Mock, pending real implementations.

`config/auth.ts` holds only `baseUrl`, storage keys, and `enableDemoTrip`. The demo trip (`utils/demo-trip.ts`) is a clearly-labeled local sample rendered alongside real trips — it bypasses the service contracts entirely and is **not** a fallback.

### What is actually persisted

This trips people up: the backend stores **Trip shells and users only**. `Trip.currentPlan` is typed `unknown` and `commentIds`/`constraintIds` are empty placeholders (`server/src/types/trip.ts`). Comments, constraints, and the computed plan live **client-side**, in a `PlanningEngine` instantiated per page in `pages/trip-detail/trip-detail.ts` — they are in-memory and lost on reload. Real-time sync/WebSocket and comment/plan persistence are unimplemented. Assume nothing planning-related round-trips to the server unless you add that yourself.

### Backend (`server/src/`)

`routes/` → `services/` → `repositories/`, assembled by `createApp()` in `server/src/app.ts` (constructor injection; `app.listen` only under `require.main === module`, which keeps it importable from tests).

`JsonTripRepository` loads the whole store into memory at construction and writes atomically (temp file + `rename`) into `server/data/` (git-ignored). It is therefore **single-process only** — concurrent server instances over one data file will clobber each other. Room-code uniqueness is re-checked at the commit point (throwing `ROOM_CODE_CONFLICT` for the service to retry) because a check-then-write would race. Legacy trips missing a `roomCode` are backfilled on load, preserving all other fields.

Auth flow: `wx.login` code → WeChat `code2Session` → openid resolved server-side → CoTrip user + HMAC token. `requireAuth` parses `Authorization: Bearer <token>` and injects `req.userId`. Errors are uniformly `{ error: { code, message } }`.

Room codes are 7 chars, uppercase, from a confusable-free alphabet (no `0/O`, `1/I/L`), **server-generated only** — never derive one client-side from tripId or a timestamp.

**Security boundaries (do not break):** `WECHAT_SECRET`/`session_key`/`openid` never leave the server; the client holds only the CoTrip token + userId; business code uses `User.id`, never openid; `creatorId`/`participantIds` come only from the validated token — client-submitted identity fields are ignored. `config/tencent-map.ts` may hold only client-public config, and ships a `YOUR_TENCENT_MAP_KEY` placeholder (`isTencentMapConfigured()` gates real calls; unconfigured shows "暂未配置地图服务" rather than fake data).

## Product invariants

These span every feature and come from the spec:

1. **AI outputs structured data, never display text.** Events/constraints/plans are objects; the frontend renders UI from data.
2. **AI never fabricates real-world facts** (venues, prices, ratings, routes). Only provider adapters (`services/providers/`, e.g. Tencent Map) supply verified entities. Routes come from map services, not the LLM. Provider returns 2 routes → show 2; never pad to a nicer number. Unknown fare → hide it, never show a placeholder.
3. **Structured values, never strings**: Time is ISO-8601 with timezone (`Asia/Shanghai`), Location has id/name/lat-lng/address, Price has amount/min/max/currency/unit. Comments always preserve raw user text.
4. **HARD vs SOFT constraints**: HARD (time windows, budget max, fixed district) must never be silently violated; unsatisfiable HARD conflicts surface an explicit Conflict — participants decide.
5. **Suggested Plan vs Current Plan**: major changes (venue swap, time shift, region change, budget increase) go through suggestion → confirmation; minor adjustments auto-apply.
6. **Shared plan + personal route**: one trip, two views. Personal departure locations stay private and only feed that user's route.
7. **Trip states**: `DRAFT → ACTIVE → COMPLETED` (+ `CANCELLED`). COMPLETED is a frozen snapshot with all editing removed. Creator-only powers: invites, member removal, cancel, complete, delete. Completion is idempotent; illegal transitions return 409.
8. **Graceful degradation**: keep last good plan, keep unparsed comments for re-parsing, hide navigation if maps fail, never fabricate data.
9. **V1 scope is frozen**: no AI chat page, social systems, albums, accounting, check-ins, points, content community, or AI persona. Test: 大家负责表达想法，AI 负责把想法变成共同计划。

## Conventions

- Strict TypeScript (`strict`, `noImplicitAny`, `strictNullChecks`); do not bypass with `any`. Path alias `@/*` maps to the repo root.
- Two-space indent, single quotes, semicolons. Kebab-case files/dirs, PascalCase types, camelCase functions.
- Business rules live in `core/` or `services/`, never page handlers.
- Third-party response shapes are isolated behind ViewModels (e.g. `RouteOption`) rather than reaching WXML directly.
- Commits follow Conventional Commits, often scoped: `feat(core): ...`, `feat(types): ...`, `docs: ...`.
- Never commit API keys, user data, or `server/data/*.json`.
