# Runbook: local development environment

## What runs

`make infra-up` starts everything the platform depends on and waits for health checks.

| Component | Endpoint | Purpose |
| --- | --- | --- |
| PostgreSQL 17 | `localhost:5432` | Financial source of truth, eight logical databases |
| Redis 7 | `localhost:6379` | Cache and rate limiting — never financial truth |
| Kafka 3.9 (KRaft) | `localhost:29092` | Stands in for Service Bus and Event Hubs (ADR-008) |
| Kafka UI | http://localhost:8080 | Topic and consumer-group inspection |
| OTel Collector | `localhost:4317` (gRPC), `:4318` (HTTP) | Single telemetry ingress, as in Azure |
| Jaeger | http://localhost:16686 | Traces |
| Prometheus | http://localhost:9090 | Metrics |
| Grafana | http://localhost:3100 | Dashboards (anonymous viewer enabled locally) |
| Loki | http://localhost:3101 | Logs |

## Commands

| Command | Effect |
| --- | --- |
| `make infra-up` | Start and wait for health |
| `make infra-down` | Stop containers, keep data |
| `make reset` | Destroy volumes and start clean |
| `make infra-health` | Print endpoints and probe PostgreSQL, Redis and Kafka |
| `make infra-logs SERVICE=kafka` | Follow logs for one component |
| `make psql DB=ledgerflow_ledger` | Open psql against a context database |
| `make test` / `make test-integration` | Unit tests / integration tests against real containers |

## Database layout

Each bounded context has its own database **and its own role**, so ownership rules are enforced
by PostgreSQL rather than by convention:

```
ledgerflow_identity        owner identity_app
ledgerflow_merchant        owner merchant_app
ledgerflow_payment         owner payment_app
ledgerflow_ledger          owner ledger_app
ledgerflow_settlement      owner settlement_app
ledgerflow_reconciliation  owner reconciliation_app
ledgerflow_risk            owner risk_app
ledgerflow_notification    owner notification_app
```

Verify the isolation at any time:

```bash
# Fails with "permission denied for database" — this is the expected result.
docker compose -f infra/docker/docker-compose.yml exec -e PGPASSWORD=payment_local_password \
  postgres psql -U payment_app -d ledgerflow_ledger -c 'select 1'
```

PostgreSQL is started with `log_lock_waits=on`, `deadlock_timeout=500ms` and
`log_min_duration_statement=500` so lock contention and slow queries are visible during
integration and concurrency tests.

## Known local-only behaviours

- **Loki reports 503 for roughly 15 seconds after start** while its ingester joins the ring.
  This is normal; `make infra-up` does not gate on it.
- **Kafka auto-topic-creation is disabled.** Topics are created explicitly, the same as in
  Azure, so a typo in a topic name fails loudly instead of silently creating a new topic.
- **Passwords in `.env.example` are local-only.** Production credentials come from Key Vault
  through Workload Identity (ADR-011); `.env` is git-ignored.
- **Single Kafka broker, replication factor 1.** Adequate for development; it cannot demonstrate
  broker failover.

## Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| `port is already allocated` | Another Postgres/Redis/Grafana is running locally | Override the port in `.env` (`POSTGRES_PORT`, `GRAFANA_PORT`, …) |
| Kafka unhealthy on first start | KRaft formatting takes longer on a cold volume | Wait for the 20s start period, then `make infra-logs SERVICE=kafka` |
| Databases missing after `make infra-up` | Init scripts run only on an empty data volume | `make reset` |
| Prometheus targets show `DOWN` for `host.docker.internal:30xx` | Services are not running on the host | Expected unless you started a service locally |
