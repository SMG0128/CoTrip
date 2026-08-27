# Repository Guidelines

## Project Structure & Module Organization

CoTrip is a native WeChat Mini Program written in TypeScript, paired with an Express backend. Mini program entry files are `app.ts`, `app.json`, and `app.wxss`. User-facing screens live in `pages/<feature>/` as matching `.ts`, `.json`, `.wxml`, and `.wxss` files. Reusable UI follows the same four-file pattern under `components/<kebab-case-name>/`; the custom tab bar lives in `custom-tab-bar/`.

Domain models belong in `types/`; keep time, location, price, and route data structured. Pure planning logic lives in `core/`. Service contracts live in `services/`, with Tencent Map provider adapters in `services/providers/`, backend-backed implementations in `services/real/`, and offline demo implementations in `services/mock/`. Runtime configuration lives in `config/`: `auth.ts` holds the backend `baseUrl`, storage keys, and the demo-trip toggle; `tencent-map.ts` holds client-safe public map config. Page-facing flow helpers (room codes, join flow, trip deletion, demo trip, metro data) live in `utils/`. Shared fixtures are under `mock/`, while unit tests are in `tests/`. Treat `AI_Coexistence_Trip_MiniProgram_V1.md` as the product specification.

`server/` is a separate npm package — a Node.js + TypeScript + Express backend providing real WeChat login (code2Session) and per-user trip persistence in local JSON files. It has its own `package.json`, `tsconfig.json`, and `tests/`; see `server/README.md` for setup, the REST API surface, and security boundaries.

## Build, Test, and Development Commands

- `npm install` installs TypeScript and WeChat Mini Program typings.
- `npm run typecheck` runs strict TypeScript validation without emitting files.
- `npm test` type-checks, compiles into temporary `.test-dist/`, runs all registered tests, and removes the temporary output.
- The backend has its own npm project inside `server/`: `npm run typecheck`, `npm run dev` (ts-node), `npm run build && npm start`, and `npm test` (compiles to `dist-test/`). Health check is `GET /health`. Server secrets go in `server/.env` (copy from `.env.example`).
- For local development, import the repository root into WeChat DevTools. Its TypeScript compiler plugin is configured in `project.config.json`; there is no separate CLI build command. The mini program talks to the backend configured as `baseUrl` in `config/auth.ts`.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes in TypeScript, semicolons, and explicit exported interfaces for domain boundaries. The project enables `strict`, `noImplicitAny`, and `strictNullChecks`; do not bypass them with `any`. Name files and feature directories in kebab-case (`plan-reconciler.ts`, `trip-detail/`), types in PascalCase, and functions/variables in camelCase. Keep business rules in `core/` or `services/`, not page handlers. AI code must produce structured data; only provider adapters may supply real venue, price, rating, or route facts.

## Testing Guidelines

Tests use lightweight assertions rather than an external framework. Add files as `tests/<module>.test.ts`, import them from `tests/run-tests.ts`, and keep fixtures deterministic. Backend tests follow the same pattern under `server/tests/` (registered in `server/tests/run-tests.ts`) and cover auth, trip isolation, idempotent join, and JSON restart persistence. Cover normal behavior, hard-constraint conflicts, and degradation paths. Run both `npm test` (root and `server/`) and a WeChat DevTools smoke check for UI changes.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, often with scopes: `feat(core): ...`, `feat(types): ...`, and `docs: ...`. Keep commits focused and use an imperative summary. Pull requests should explain the user-visible change, list validation performed, link related issues/spec sections, and include screenshots or recordings for WXML/WXSS changes. Call out configuration changes and any new external provider dependency.

## Security & Configuration

Never commit API keys, user data, or private coordinates. Keep provider credentials outside source control; `server/.env` and `server/data/*.json` (users, trips) are git-ignored. AI and map calls may degrade gracefully, but login and trip persistence go through the real backend only — when it is unreachable they must fail explicitly, never silently fall back to mock data (the demo trip in `utils/demo-trip.ts` is a clearly-labeled local sample, not a fallback).

Backend security boundaries: `WECHAT_SECRET`, `session_key`, and `openid` stay server-side and are never sent to the mini program, which only holds the CoTrip token and CoTrip user id. Business code uses `User.id`, never openid, and trip `creatorId`/`participantIds` always come from the verified token — client-submitted identity fields are ignored. `config/tencent-map.ts` may only contain client-public config; any key that must be protected goes through the backend, not the mini program.
