# Repository Guidelines

## Project Structure & Module Organization

CoTrip is a native WeChat Mini Program written in TypeScript. Application entry files are `app.ts`, `app.json`, and `app.wxss`. User-facing screens live in `pages/<feature>/` as matching `.ts`, `.json`, `.wxml`, and `.wxss` files. Reusable UI follows the same four-file pattern under `components/<kebab-case-name>/`.

Domain models belong in `types/`; keep time, location, price, and route data structured. Pure planning logic lives in `core/`, service contracts and provider adapters in `services/`, and local implementations in `services/mock/`. Shared fixtures are under `mock/`, while unit tests are in `tests/`. Treat `AI_Coexistence_Trip_MiniProgram_V1.md` as the product specification.

## Build, Test, and Development Commands

- `npm install` installs TypeScript and WeChat Mini Program typings.
- `npm run typecheck` runs strict TypeScript validation without emitting files.
- `npm test` type-checks, compiles into temporary `.test-dist/`, runs all registered tests, and removes the temporary output.
- For local development, import the repository root into WeChat DevTools. Its TypeScript compiler plugin is configured in `project.config.json`; there is no separate CLI build command.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes in TypeScript, semicolons, and explicit exported interfaces for domain boundaries. The project enables `strict`, `noImplicitAny`, and `strictNullChecks`; do not bypass them with `any`. Name files and feature directories in kebab-case (`plan-reconciler.ts`, `trip-detail/`), types in PascalCase, and functions/variables in camelCase. Keep business rules in `core/` or `services/`, not page handlers. AI code must produce structured data; only provider adapters may supply real venue, price, rating, or route facts.

## Testing Guidelines

Tests use lightweight assertions rather than an external framework. Add files as `tests/<module>.test.ts`, import them from `tests/run-tests.ts`, and keep fixtures deterministic. Cover normal behavior, hard-constraint conflicts, and degradation paths. Run both `npm test` and a WeChat DevTools smoke check for UI changes.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, often with scopes: `feat(core): ...`, `feat(types): ...`, and `docs: ...`. Keep commits focused and use an imperative summary. Pull requests should explain the user-visible change, list validation performed, link related issues/spec sections, and include screenshots or recordings for WXML/WXSS changes. Call out configuration changes and any new external provider dependency.

## Security & Configuration

Never commit API keys, user data, or private coordinates. Keep provider credentials outside source control and preserve graceful fallback behavior when AI, maps, or third-party services fail.
