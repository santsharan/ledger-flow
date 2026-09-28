# Production readiness

This is a review of the repository as it stands. It is not a claim that LedgerFlow is production ready.
"Pass" means the behavior is implemented and an automated test or a compiled artifact demonstrates it.
"Partial" means the design is present and incomplete. "Fail" means the requirement is not met.
No Azure resource was deployed, and no load test was executed.

## PASS

Financial correctness of the pieces that are tested:

- Money is integer minor units. Construction from a fractional number throws. Currency mismatch throws.
- A posted journal balances, has at least two entries, and one currency. Database constraints reject a bypass.
- Posted ledger entries cannot be updated or deleted. Corrections are reversal journals.
- Capture cannot exceed authorization. Refund cannot exceed capture. Twenty competing ledger posts and eight competing captures apply once.
- The same settlement inputs reproduce the snapshot digest. Net is `gross - refunds - chargebacks - fees + adjustments`.
- A settlement cannot be confirmed twice, and a capture source cannot be placed in two batches.
- Provider timeout stores `AUTHORIZATION_UNKNOWN` and does not post a ledger journal. Lookup resolves that same attempt once.
- The provider call is not inside a database transaction. A test counts calls made while a transaction is open.
- Outbox rows commit with the business change. Broker refusal and publisher crash both leave a pending row that a later pass publishes. The inbox applies the effect once.
- Reconciliation of internal 10000 against external 9900 opens `AMOUNT_MISMATCH` and does not write a payment or ledger table. Resolution stores actor and reason. The same file digest does not open a second case.
- Risk decisions are deterministic and the stored row cannot be updated.
- Authorization checks permissions, not role names. Merchant-scoped tokens cannot read another merchant.
- Bicep for the listed Azure modules compiles with current API versions. Parameter files contain no passwords. Workload identities are not Owner or Contributor. The permission matrix matches the role assignments.

## PARTIAL

- Ledger posting from a capture is still a call after commit, plus an outbox row. If the process dies after commit and before that call, the posting stays `PENDING` until `POST /payments/{id}/ledger-postings` or a publisher consumer runs. There is no deployed consumer that posts the ledger from `PaymentCaptured`.
- The Kafka adapter exists. Crash tests use an in-memory publisher, not a Kafka container and not Service Bus or Event Hubs.
- Redis is in Docker Compose and Bicep. No service reads or writes it. A Redis outage cannot corrupt the ledger because Redis is not on the path, and that also means cache, rate limiting, and a Redis failure test do not exist.
- OpenTelemetry starts when enabled and auto-instruments HTTP and PostgreSQL. Business counters are incremented for payment creation and ledger posting only. The Grafana dashboard and three alert rules are declared. They were not viewed in Grafana or Azure Monitor.
- Kubernetes manifests have probes, disruption budgets, HPA, one KEDA scaled object, and a default-deny network policy. They were not applied. Shutdown behavior is implemented in the process and not observed on a terminating pod.
- PostgreSQL zone-redundant HA, private endpoints, and backup retention are declared in Bicep. Failover and restore were not run. RPO and RTO in the disaster-recovery note are assumptions.
- API gateway, notification service, and the acquirer HTTP surface are thinner than the domain services behind them. The gateway does not yet route, rate-limit, or validate tokens for every downstream API.
- Load scripts exist at `tests/load`. No k6 run was captured, so there is no p50, p95, or p99 baseline.

## FAIL

- No evidence of an Azure deployment, image digest rollout, or smoke test after deploy.
- No evidence of a backup restore.
- No evidence of Service Bus or Event Hubs behavior under interruption. The local recovery path is the outbox, which is tested against a stand-in broker only.
- No performance numbers. Changing pool sizes or indexes from this review would be guessing.
- Cross-region recovery is not implemented. Prod enables geo-redundant backup and nothing consumes it.
- The platform must not be described as exactly-once. Delivery is at-least-once. Effect-once holds only where an idempotency key, inbox row, or ledger reference constraint was tested.

## RISK

- A capture can be committed while its ledger posting is still pending. Operators must treat `PENDING` postings as unfinished money movement.
- Service Bus duplicate detection is a 10-minute window. It is not the idempotency mechanism. The inbox is. A consumer that skips the inbox will double-apply.
- Key Vault Secrets User is vault-scoped. A service that can read one secret can read the others in that vault.
- The acquirer simulator can change failure mode with an admin token. That token must not be deployed in prod. The simulator should not be in the prod cluster.
- Database administrator password is a pipeline secret. If it is reused as the application login, every service shares a superuser. Per-database roles exist for local Postgres and are not created by the Bicep module.
- Single-region. A region loss is an outage until a restore that has never been rehearsed.

## RECOMMENDATION

1. Do not send production traffic. Run a restore drill and an Azure deploy of `dev` before any demo that claims cloud recovery.
2. Consume `PaymentCaptured` from the outbox inside the ledger service so a crash cannot leave a capture without a journal except as a visible pending row with an automatic retry.
3. Capture one k6 baseline on the payment create and ledger balance scripts before changing database pool or autoscaler settings.
4. Keep Redis off the financial path until a real cache use exists, and add a failure test only then.
5. Give each service its own PostgreSQL role in the Flexible Server bootstrap, matching the local init scripts.
6. Leave the acquirer simulator out of prod and keep its admin token out of the cluster.
