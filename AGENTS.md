# Repository Guidelines

## Project Structure & Module Organization

CoTrip is a native WeChat Mini Program written in TypeScript, paired with an Express backend. Mini program entry files are `app.ts`, `app.json`, and `app.wxss`. User-facing screens live in `pages/<feature>/` as matching `.ts`, `.json`, `.wxml`, and `.wxss` files. Reusable UI follows the same four-file pattern under `components/<kebab-case-name>/`; the custom tab bar lives in `custom-tab-bar/`. Global design tokens and shared styles live in `styles/` (`tokens.wxss`, `typography.wxss`, `utilities.wxss`, `glass.wxss`), imported by `app.wxss` — reuse these variables instead of hardcoding colors, radii, or shadows.

Domain models belong in `types/`; keep time, location, price, and route data structured. Pure planning logic lives in `core/` (zero `wx.*` references, fully unit-testable). Service contracts live in `services/`, with Tencent Map provider adapters in `services/providers/`, backend-backed implementations in `services/real/`, and offline demo implementations in `services/mock/`. Runtime configuration lives in `config/`: `auth.ts` holds the backend `baseUrl`, storage keys, and the demo-trip toggle; `tencent-map.ts` holds client-safe public map config. Page-facing flow helpers (room codes, join flow, trip deletion, trip completion/sharing, demo trip, metro data) live in `utils/`. Shared fixtures are under `mock/`, while unit tests are in `tests/`. Treat `AI_Coexistence_Trip_MiniProgram_V1.md` as the product specification and `README.md` as the record of what is actually shipped vs. missing. `CLAUDE.md` carries extended agent notes on the same topics.

`server/` is a separate npm package — a Node.js + TypeScript + Express backend providing real WeChat login (code2Session) and per-user trip persistence in local JSON files. It has its own `package.json`, `tsconfig.json`, and `tests/`; see `server/README.md` for setup, the REST API surface, and security boundaries.

## Architecture Boundaries & Gotchas

- Service wiring is **static** in `services/index.ts` — there is no mock/real mode switch, and none should be reintroduced: `authService`/`tripService` are always the real backend implementations, and `routeOptionService` is `RealRouteOptionService` (Tencent direction v1, enabled). Real trips must clear the "我的推荐" gate in `utils/personal-route.ts` — personal departure place → first plan location, no request if either is missing. The built-in demo trip is **explicitly exempt from that gate** and uses the fixed mock Guangzhou fixture directly so it stays usable out of the box. `DisabledRouteOptionService` is kept as a kill switch. AI/map/place/notification/externalAction are still mock implementations pending real ones.
- The backend persists **users and trip shells only**. Comments, constraints, and the computed plan do not round-trip: they live client-side in a per-page `PlanningEngine` (see `pages/trip-detail/trip-detail.ts`) and are lost on reload. Real-time sync and comment/plan persistence are unimplemented — assume nothing planning-related reaches the server unless you add it.
- Root and `server/` are independent TypeScript projects; the root tsconfig excludes `server/`. The path alias `@/*` maps to the repo root.
- `JsonTripRepository` loads the whole store into memory and writes atomically to `server/data/` — it is single-process only. Room codes are 7 chars from a confusable-free alphabet and are **server-generated only**; never derive one client-side.
- Isolate third-party response shapes behind ViewModels (e.g. `RouteOption`) rather than binding provider data in WXML directly.

## Build, Test, and Development Commands

- `npm install` installs TypeScript and WeChat Mini Program typings.
- `npm run typecheck` runs strict TypeScript validation without emitting files.
- `npm test` type-checks, compiles into temporary `.test-dist/`, runs all registered tests, and removes the temporary output.
- The backend has its own npm project inside `server/`: `npm run typecheck`, `npm run dev` (ts-node, binds 127.0.0.1:3000), `npm run build && npm start`, and `npm test` (compiles to `dist-test/`). Health check is `GET /health`. Server secrets go in `server/.env` (copy from `.env.example`). Note `loadConfig()` (`server/src/config/index.ts`) throws if `WECHAT_APPID`/`WECHAT_SECRET`/`AUTH_TOKEN_SECRET` are absent, so `npm run dev` needs a real `.env`; server tests construct repositories directly and run without one.
- For local development, import the repository root into WeChat DevTools. Its TypeScript compiler plugin is configured in `project.config.json`; there is no separate CLI build command. The mini program talks to the backend configured as `baseUrl` in `config/auth.ts`.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes in TypeScript, semicolons, and explicit exported interfaces for domain boundaries. The project enables `strict`, `noImplicitAny`, and `strictNullChecks`; do not bypass them with `any`. Name files and feature directories in kebab-case (`plan-reconciler.ts`, `trip-detail/`), types in PascalCase, and functions/variables in camelCase. Comments, UI copy, and test assertion messages are largely in Chinese — match that. Keep business rules in `core/` or `services/`, not page handlers. AI code must produce structured data; only provider adapters may supply real venue, price, rating, or route facts, and a provider returning fewer options than the UI ideally wants must never be padded with fabricated ones.

## Testing Guidelines

Tests use lightweight assertions rather than an external framework. Add files as `tests/<module>.test.ts`, import them from `tests/run-tests.ts`, and keep fixtures deterministic. Root tests come in two styles, both registered in `run-tests.ts`: side-effect files that assert at import time, and async files exporting `run*Tests()` awaited by `main()`. Backend tests follow the same pattern under `server/tests/` (every file exports `run*Tests()`, registered in `server/tests/run-tests.ts`) and cover auth, trip isolation, idempotent join, and JSON restart persistence — but `run-tests.ts` calls `main()` at module top level, so importing any single compiled test file executes the entire suite; run `npm test` and read the per-case output. Cover normal behavior, hard-constraint conflicts, and degradation paths. Run both `npm test` (root and `server/`) and a WeChat DevTools smoke check for UI changes.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, often with scopes: `feat(core): ...`, `feat(types): ...`, and `docs: ...`. Keep commits focused and use an imperative summary. Pull requests should explain the user-visible change, list validation performed, link related issues/spec sections, and include screenshots or recordings for WXML/WXSS changes. Call out configuration changes and any new external provider dependency.

## Security & Configuration

Never commit API keys, user data, or private coordinates. Keep provider credentials outside source control; `server/.env` and `server/data/*.json` (users, trips) are git-ignored. AI and map calls may degrade gracefully, but login and trip persistence go through the real backend only — when it is unreachable they must fail explicitly, never silently fall back to mock data (the demo trip in `utils/demo-trip.ts` is a clearly-labeled local sample, not a fallback).

Backend security boundaries: `WECHAT_SECRET`, `session_key`, and `openid` stay server-side and are never sent to the mini program, which only holds the CoTrip token and CoTrip user id. Business code uses `User.id`, never openid, and trip `creatorId`/`participantIds` always come from the verified token — client-submitted identity fields are ignored. `config/tencent-map.ts` may only contain client-public config; any key that must be protected goes through the backend, not the mini program.
