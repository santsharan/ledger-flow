# ADR-017: pnpm monorepo with NestJS on Fastify

Status: Accepted
Date: 2026-09-25

## Context

Ten services share a money type, an error model, an event envelope, a messaging abstraction and a
database layer. Those shared pieces must stay in lockstep: an event envelope change that reaches
one service but not another produces a production incident, not a compile error.

The services also need a consistent HTTP runtime, dependency-injection story, validation approach
and testing setup, so that reviewing one service teaches you how all of them work.

## Decision

- **pnpm workspace monorepo.** One lockfile, atomic cross-package changes, strict
  `node_modules` layout that prevents accidental use of undeclared transitive dependencies.
- **TypeScript in strict mode** (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  project references for incremental builds.
- **NestJS** for structure: modules mirror bounded contexts, DI makes repository/port substitution
  in tests straightforward, and lifecycle hooks (`onApplicationShutdown`) give the graceful
  shutdown sequence a natural home.
- **Fastify** as the HTTP adapter rather than Express: faster, first-class schema handling, and an
  actively maintained plugin ecosystem for the edge concerns needed here (rate limiting, helmet,
  body limits).
- **Zod** for runtime validation at every boundary (HTTP, config, event payloads), with types
  inferred from schemas so the validator and the type cannot drift apart.
- **Vitest + Supertest + Testcontainers** for unit, HTTP and integration tests against real
  PostgreSQL/Kafka/Redis.
- **Pino** for structured JSON logs with structural redaction.
- Node.js 22 LTS as the runtime baseline; the exact version is pinned in `.nvmrc`/`engines` and in
  the container base image so local, CI and production agree.

## Alternatives considered

- **Polyrepo (one repository per service).** Realistic for a large organization, but every shared
  contract change becomes a multi-PR version dance — the opposite of what a portfolio project
  should spend effort on.
- **npm/yarn workspaces.** Workable; pnpm's stricter linking and faster CI installs win.
- **Nx or Turborepo.** Good task orchestration and caching; adds a build-tool learning surface on
  top of the architecture being demonstrated. pnpm scripts plus TypeScript project references are
  sufficient at this size, and either can be layered on later.
- **Plain Fastify without NestJS.** Less abstraction and less startup overhead, but DI, module
  boundaries and lifecycle management would be hand-rolled across ten services.
- **Express.** Slower, and its schema/validation story is weaker.

## Trade-offs

- NestJS adds indirection and a decorator-heavy style that is not to everyone's taste, and its
  Fastify adapter occasionally lags Fastify releases.
- A monorepo requires discipline: shared packages must not become a dumping ground, and the
  bounded-context rules (no cross-context data access) are enforced by review and lint rules
  rather than by repository boundaries.
- Full-repo CI is slower than per-service CI without task caching; mitigated by project references
  and, if needed later, a task runner.

## Consequences

- A breaking change to a shared contract fails the build immediately, in one pull request.
- Every service has the same shape: `main.ts`, module graph, config schema, health endpoints,
  telemetry bootstrap, graceful shutdown.
- Shared packages carry no business state — they are libraries, not a shared database.
