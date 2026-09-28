# LedgerFlow

A distributed payments, double-entry ledger, settlement and reconciliation platform.

LedgerFlow is a production-oriented simulation of a merchant payment platform. It exists to
demonstrate the engineering problems that make payment systems hard — financial correctness under
concurrency, ambiguous outcomes from external providers, idempotency, immutable accounting,
settlement reproducibility and reconciliation — rather than to collect technologies.

No real payment processor is connected. The acquirer is a deterministic simulator so that
timeouts, lost responses, duplicate responses and wrong settlement amounts can be reproduced on
demand.

## Engineering problems this project demonstrates

| Problem | Where it is solved |
| --- | --- |
| Money must never be a float | `packages/money`, [ADR-016](docs/adr/ADR-016-money-representation.md) |
| Debits must equal credits, always | [ledger architecture](docs/architecture/ledger-architecture.md), [ADR-002](docs/adr/ADR-002-why-double-entry-ledger.md) |
| Financial history must be immutable | [ADR-003](docs/adr/ADR-003-immutable-ledger.md) |
| A provider may succeed while the response is lost | [ADR-005](docs/adr/ADR-005-external-provider-unknown-state.md) |
| Events must not be lost or published before commit | [ADR-006](docs/adr/ADR-006-transactional-outbox.md) |
| Duplicate delivery must not duplicate money | [ADR-007](docs/adr/ADR-007-inbox-idempotency.md) |
| Historical settlements must be reproducible | [ADR-010](docs/adr/ADR-010-settlement-architecture.md) |
| Discrepancies must be found, not guessed at | [reconciliation architecture](docs/architecture/reconciliation-architecture.md) |

## Repository layout

```
server/
  apps/                 ten services (see below)
  packages/             shared libraries — no business state lives here
  infra/docker/         container build
  docs/                 architecture, ADRs, security, runbooks
  scripts/              repository tooling
```

### Services

| Service | Port | Owns |
| --- | --- | --- |
| `api-gateway` | 3000 | Edge routing, authentication, rate limiting |
| `identity-service` | 3001 | Users, roles, permissions, tokens |
| `merchant-service` | 3002 | Merchant profile, status, settlement configuration |
| `payment-service` | 3003 | Payment lifecycle, attempts, idempotency |
| `ledger-service` | 3004 | Accounts, journals, immutable entries |
| `settlement-service` | 3005 | Batches, calculation, snapshots, payout lifecycle |
| `reconciliation-service` | 3006 | Statement import, matching, cases |
| `risk-service` | 3007 | Deterministic risk rules and decisions |
| `notification-service` | 3008 | Notification requests and delivery simulation |
| `acquirer-simulator` | 3009 | Deterministic external acquirer with failure modes |

Each service owns its own PostgreSQL logical database and never reads another's — see
[bounded contexts](docs/architecture/bounded-contexts.md).

### Shared packages

| Package | Purpose | Added in |
| --- | --- | --- |
| `config` | Zod-validated environment configuration | Phase 1 |
| `errors` | Typed application errors and the API error envelope | Phase 1 |
| `logger` | Pino with structural redaction | Phase 1 |
| `service-core` | Service template: bootstrap, health, error filter, graceful shutdown | Phase 1 |
| `test-utils` | HTTP test harness, container fixtures | Phase 1 |
| `money` | Integer minor-unit money and currency rules | Phase 3 |
| `database` | Pool, transactions, migrations, error mapping | Phase 3 |
| `auth`, `audit`, `contracts`, `events`, `messaging`, `idempotency`, `observability` | | Phases 4–13 |

## Getting started

Requires Node.js 22 LTS, pnpm 9 and Docker.

```bash
cd server
pnpm install
pnpm verify        # format, lint, typecheck, unit tests, build
make infra-up      # PostgreSQL, Redis, Kafka, Prometheus, Grafana, Jaeger, Loki, OTel Collector
```

`make infra-up` waits for health checks and prints every endpoint. See the
[local environment runbook](docs/runbooks/local-environment.md) for the component list,
database layout and troubleshooting.

Run a single service:

```bash
pnpm --filter @ledgerflow/payment-service build
SERVICE_NAME=payment-service PORT=3003 LOG_PRETTY=true \
  node apps/payment-service/dist/main.js

curl localhost:3003/health/ready
```

Add a new service from the template:

```bash
node scripts/scaffold-service.mjs my-service 3010 "What it owns."
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | ESLint with type-aware rules |
| `pnpm format` / `pnpm format:fix` | Prettier |
| `pnpm typecheck` | Whole-repository `tsc --noEmit` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Integration tests against real containers |
| `pnpm build` | Build every package and service in dependency order |
| `pnpm verify` | Everything CI runs on a pull request |
| `make infra-up` / `make infra-down` / `make reset` | Local infrastructure lifecycle |
| `make psql DB=ledgerflow_ledger` | Open psql against one context database |
| `make help` | List every Make target |

## Documentation

- [System context](docs/architecture/system-context.md)
- [Bounded contexts and data ownership](docs/architecture/bounded-contexts.md)
- [Payment lifecycle](docs/architecture/payment-lifecycle.md)
- [Ledger architecture](docs/architecture/ledger-architecture.md)
- [Settlement architecture](docs/architecture/settlement-architecture.md)
- [Reconciliation architecture](docs/architecture/reconciliation-architecture.md)
- [Failure model](docs/architecture/failure-model.md)
- [Azure topology](docs/architecture/azure-topology.md)
- [Security trust boundaries](docs/security/trust-boundaries.md)
- [Architecture decision records](docs/adr/README.md)

## Status

The domain services, local infrastructure, Azure templates, and cluster manifests are in the
tree. [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) records what is tested, what is only
declared, and what has not been run. The project is not production ready.

Failure evidence is indexed in [docs/failure/scenarios.md](docs/failure/scenarios.md). Recovery
assumptions are in [docs/disaster-recovery/strategy.md](docs/disaster-recovery/strategy.md).
Load scripts are in `tests/load` and have no captured baseline yet.
