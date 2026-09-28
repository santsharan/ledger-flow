# ADR-013: Azure Database for PostgreSQL Flexible Server

Status: Accepted
Date: 2026-09-25

## Context

ADR-001 chose PostgreSQL. In Azure, the options are a managed offering or self-managing PostgreSQL
on AKS. The financial source of truth needs high availability, point-in-time recovery, private
connectivity, and predictable patching — none of which are things this project should be
hand-building.

## Decision

Use **Azure Database for PostgreSQL Flexible Server**:

- **Zone-redundant HA** with a warm standby and synchronous replication in `prod`/`demo`; single
  zone in `dev` to control cost.
- **Private endpoint only**, public access disabled, TLS enforced (ADR-012).
- **Automated backups with point-in-time restore** inside the configured retention window.
- **Entra ID authentication** for workloads where supported; otherwise a Key Vault-held password.
- One server hosting the seven logical databases in `dev`/`demo`, with per-database roles enforcing
  ownership; `prod` may split servers per context if isolation or scaling demands it.
- The **PostgreSQL major version is selected at implementation time** against Azure's currently
  supported versions rather than pinned here, because pinning a version in an architecture
  document is how projects end up on an unsupported release.

Application-side requirements that follow from managed HA:

- Failover drops in-flight connections, so the pool must reconnect and operations must be
  retry-safe and idempotent.
- Connection pooling is bounded and configured per service; PgBouncer (built into Flexible Server)
  is used where connection counts justify it.
- No long-running transaction may span an external network call (see ADR-005/ADR-006).

## Alternatives considered

- **PostgreSQL on AKS (StatefulSet, operator).** Full control, and full responsibility for backup,
  failover, patching and storage. Wrong trade for a financial source of truth in a project whose
  point is engineering judgment, not sysadmin volume.
- **Azure Cosmos DB for PostgreSQL (Citus).** Distributed scale-out, more operational complexity
  than the workload needs; sharding is a documented future option if per-merchant volume demands
  it.
- **Single-zone Flexible Server everywhere.** Cheaper, but a zone outage becomes an availability
  outage of the ledger.
- **Read replicas as an HA mechanism.** Replicas serve read scale, not automatic failover.

## Trade-offs

- Less control over extensions, configuration parameters and patch timing than self-managed.
- Zone-redundant HA roughly doubles database cost.
- Failover is seconds-to-minutes with connection resets, not transparent — the application must be
  written for it, which is enforced by the failure tests (F1–F3).
- Version upgrades are on Azure's schedule and must be planned.

## Consequences

- HA, PITR and patching are platform concerns rather than project code.
- Reconnect/retry behaviour is a tested requirement, not an assumption.
- Disaster-recovery documentation states RPO/RTO based on the actual backup and HA configuration,
  with cross-region DR listed as a known gap rather than an implied capability.
