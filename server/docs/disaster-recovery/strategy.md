# Disaster recovery

These are assumptions, not measured failover drills. Nothing in this document was executed against Azure.

## Scope

One region. Zone-redundant PostgreSQL in `demo` and `prod`. No cross-region application failover is built.

## Recovery objectives

| Failure | RPO | RTO | Basis |
| --- | --- | --- | --- |
| PostgreSQL zone failure (`demo`, `prod`) | About 0 for committed transactions | Minutes, not seconds | Flexible Server zone-redundant HA uses a warm standby and synchronous replication. In-flight transactions are aborted. The application must reconnect and retry idempotent operations. This failover was not timed here. |
| PostgreSQL zone failure (`dev`) | Last backup | Restore time, hours | High availability is off in dev. |
| Point-in-time restore | Up to the backup retention window (7 days dev/demo, 35 days prod) plus the service's backup cadence | Hours | Automated backups are declared in Bicep. A restore was not performed. |
| Region outage | Last geo-redundant backup in prod only; none in dev/demo | Not defined | Geo-redundant backup is enabled only for prod. There is no second region and no tested restore runbook. Do not quote an RTO. |
| Broker outage | 0 for events already in the outbox | Until the publisher runs again | The outbox row is committed with the business change. Broker retention is not the recovery source. |
| Lost publisher ack | 0 | Next publisher pass | The same event id is published again. The inbox drops the duplicate. |
| Reconciliation job crash | 0 for an already stored statement | Re-run the import | The same provider and file digest returns the existing run and does not open another case. |

## What was tested locally

| Check | Result |
| --- | --- |
| Committed database row survives a closed pool and is readable from a new pool | Automated |
| Broker refusal leaves the outbox pending and a later publish sends it once | Automated |
| Publisher crash after accept republishes the same event id | Automated |
| Consumer crash before commit retries the effect; crash after commit does not | Automated |
| Identical reconciliation import does not create a second case | Automated |
| Backup restore, Azure failover, and message replay from Service Bus or Event Hubs | Not tested |

## Operator sequence for a database failover

1. Expect connection errors (`DATABASE_UNAVAILABLE` or `DATABASE_TIMEOUT`) while the standby is promoted.
2. Confirm the new primary accepts connections. Readiness probes remove pods that cannot ping PostgreSQL.
3. Do not replay payment API calls that already returned success. Idempotency keys and ledger reference uniqueness make a retry safe, but a blind retry of an unknown authorization is not. Use status lookup.
4. Run the outbox publisher. Pending rows are the list of facts that have not reached the broker.
5. Re-run reconciliation for any window whose run is not `COMPLETED`. A completed import with the same digest is a no-op.

## What this strategy does not cover

- Restoring into a new region and repointing private DNS.
- Rebuilding Key Vault or the AKS cluster from scratch.
- Proving the stated RTO. The numbers above are the platform's documented behavior, not a drill result.
