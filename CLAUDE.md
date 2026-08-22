# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CoTrip — AI-powered collaborative trip planner as a native WeChat Mini Program (TypeScript), plus its Node.js/Express backend in `server/`. Participants express needs as natural-language comments; an AI layer converts them into structured constraints and maintains one shared executable plan. The authoritative product spec is `AI_Coexistence_Trip_MiniProgram_V1.md` — read it before implementing any module. `AGENTS.md` and `CODEBUDDY.md` carry earlier agent-facing notes; this file supersedes them where they conflict.

Comments, UI copy, and test assertion messages are largely in Chinese — match that.

## Commands

### Mini program (repo root)

- Run/preview: open the repo root in WeChat DevTools (微信开发者工具). TypeScript compiles via its built-in plugin configured in `project.config.json`; there is no CLI build.
- `npm install` — dev deps only (`typescript`, `miniprogram-api-typings`).
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — typecheck, compile to temporary `.test-dist/`, run all tests, clean up.

There is no test framework. Tests are plain `.ts` files using local `assert()` helpers. Most run as side-effect imports; some export a `run*Tests()` function that `tests/run-tests.ts` awaits in `main()`. A new test file must be registered in `tests/run-tests.ts` (and `server/tests/run-tests.ts` for backend tests). To run one file in isolation, compile and invoke it directly:

```bash
npx tsc --outDir .test-dist --module commonjs && node .test-dist/tests/constraint-parser.test.js
```

(For `run*Tests`-style files, import and call the function instead.)

### Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env   # fill WECHAT_APPID, WECHAT_SECRET, AUTH_TOKEN_SECRET, PORT
npm run dev            # ts-node development mode
npm run build && npm start   # production
npm run typecheck
npm test               # typecheck + compile to dist-test/ + run server/tests
```

Health check: `GET http://localhost:3000/health`.

The root and `server/` are independent TypeScript projects (root tsconfig excludes `server/`). Run their commands separately.

## Architecture

Two layers, strictly separated:

**Mini program** (root): pages/components follow the four-file pattern (`.ts/.json/.wxml/.wxss`) under `pages/<feature>/` and `components/<kebab-name>/`.

- `types/` — domain models (Trip, Plan, Event, Constraint, Comment, Time, Location, Price, Route…).
- `core/` — pure planning logic, no WeChat runtime dependencies: `constraint-parser` → `ConstraintStore` → `conflict-detector` → `candidate-ranker` → `plan-reconciler` / `planning-engine`.
- `services/` — interface per capability (`ai-service`, `trip-service`, `map-service`, `place-service`, `notification-service`, `external-action-service`, `auth-service`) with implementations in `services/mock/` and `services/real/`. **`services/index.ts` is the single wiring point**: it picks mock vs real based on `config/auth.ts` (`mode: 'mock' | 'real'`). In `real` mode a backend failure fails loudly — never silently fall back to Mock.
- `mock/` — deterministic fixtures. `utils/` — shared helpers. `custom-tab-bar/` — tabBar is custom (`app.json`).

**Backend** (`server/src/`): `routes/` → `services/` → `repositories/` (JSON-file persistence in `server/data/`, git-ignored). Auth flow: `wx.login` code → WeChat `code2Session` → openid resolved server-side only → CoTrip user + HMAC token issued. Endpoints: `/auth/login`, `/auth/profile`, `/trips`, `/trips/:id`; errors are `{ error: { code, message } }`.

Security boundaries (do not break): `WECHAT_SECRET`/`session_key`/`openid` never leave the server; the client holds only CoTrip token + userId; business code uses `User.id`, never openid; `creatorId`/`participantIds` come only from the validated token — client-submitted identity fields are ignored.

## Product invariants

These span every feature and come from the spec:

1. **AI outputs structured data, never display text.** Events/constraints/plans are objects; the frontend renders UI from data.
2. **AI never fabricates real-world facts** (venues, prices, ratings, routes). Only provider adapters (`services/providers/`, e.g. Tencent Map) supply verified entities. Routes come from map services, not the LLM.
3. **Structured values, never strings**: Time is ISO-8601 with timezone (`Asia/Shanghai`), Location has id/name/lat-lng/address, Price has amount/min/max/currency/unit. Comments always preserve raw user text.
4. **HARD vs SOFT constraints**: HARD (time windows, budget max, fixed district) must never be silently violated; unsatisfiable HARD conflicts surface an explicit Conflict — participants decide.
5. **Suggested Plan vs Current Plan**: major changes (venue swap, time shift, region change, budget increase) go through suggestion → confirmation; minor adjustments auto-apply.
6. **Shared plan + personal route**: one trip, two views. Personal departure locations stay private and only feed that user's route.
7. **Trip states**: `DRAFT → ACTIVE → COMPLETED` (+ `CANCELLED`). COMPLETED is a frozen snapshot with all editing removed. Creator-only powers: invites, member removal, cancel, complete.
8. **Graceful degradation**: keep last good plan, keep unparsed comments for re-parsing, hide navigation if maps fail, never fabricate data.
9. **V1 scope is frozen**: no AI chat page, social systems, albums, accounting, check-ins, points, content community, or AI persona. Test: 大家负责表达想法，AI 负责把想法变成共同计划。

## Conventions

- Strict TypeScript (`strict`, `noImplicitAny`, `strictNullChecks`); do not bypass with `any`.
- Two-space indent, single quotes, semicolons. Kebab-case files/dirs, PascalCase types, camelCase functions.
- Business rules live in `core/` or `services/`, never page handlers.
- Commits follow Conventional Commits, often scoped: `feat(core): ...`, `feat(types): ...`, `docs: ...`.
- Never commit API keys, user data, or `server/data/*.json`.
