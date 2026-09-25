# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted feature-flag service: an Express 5 API backed by Redis that streams flag changes
over SSE, a shared evaluation engine, a browser JS SDK with React and Vue bindings, and a React
admin dashboard. npm workspaces monorepo, TypeScript throughout.

## Commands

```bash
npm install
npm test                                   # vitest across every workspace (one root config, projects per package)
TEST_REDIS_URL=redis://localhost:6379 npm test   # also runs the Redis store contract and multi-instance tests
npx vitest run --project server            # one package (names: core, server, js, react, vue, dashboard)
npx vitest run -t "rollout grows"          # one test by name
npm run typecheck                          # tsc --noEmit per workspace (vue-tsc for the Vue demo)
npm run lint                               # oxlint

docker compose up -d redis                 # Redis for local dev
npm run seed                               # demo flags; reads packages/server/.env.local
npm run dev                                # API :4000 (tsx watch) + dashboard :5173 (Vite proxies /api, /sdk)
npm run dev:examples                       # React demo :5174, Vue demo :5175 (production env, key sdk-production-demo)
npm run build                              # dashboard (Vite) + server (esbuild, one self-contained file)
docker compose up --build                  # Redis + 2 API replicas + nginx on :4000
```

## Architecture

- `packages/core` is the single source of truth for flag semantics. `schema.ts` (Zod) validates
  writes on the server; `evaluate.ts` + `hash.ts` are pure and run identically on the server and in
  browsers. Browser code imports `@flagforge/core/engine`, which has no Zod. Keep it that way:
  never import the root `@flagforge/core` from `packages/js`, `react` or `vue`.
- Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`); there is no
  per-package build. The server bundle inlines everything, including npm deps, so the Docker
  runtime image has no node_modules.
- Server layering: `http/app.ts` parses and maps errors only; `service.ts` owns business rules;
  `store/` is behind the `Store` interface with memory and Redis implementations that must pass
  the same `store.contract.test.ts`.
- Every flag write goes through `FlagService.write()`: read → mutate a clone → validate → diff for
  the audit log → compare-and-set on `updatedAt` (Lua in Redis) → audit → publish. Changing
  `updatedAt` on every write is what makes it a lock token.
- Change propagation: `store.publish` → every instance's `StreamHub` → one payload rebuild per
  revision → `event: put` to SDK streams. SDKs ignore payloads with a lower `version`.
- The JS client exposes `revision` (bumped on every observable change). React hooks subscribe via
  `useSyncExternalStore` and must return stable snapshots; `useFlag` snapshots the raw variation
  value, not the defaulted one, to avoid loops with inline object defaults.

## Conventions

- Conventional commits (`feat(server): …`, `fix(js): …`).
- Tests sit next to the code (`*.test.ts`). Testing Library cleanup is explicit via
  `src/test/setup.ts` because Vitest globals are off.
- A missing context attribute never matches a clause, including negated operators. Rollout weights
  are percentages that must sum to 100.
