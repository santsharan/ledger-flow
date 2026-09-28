# ADR-014: HPA for synchronous APIs, KEDA for event-driven workers

Status: Accepted
Date: 2026-09-25

## Context

The platform has two workload shapes with different scaling signals:

- **Synchronous APIs** (`api-gateway`, `payment-service`, `ledger-service`, `merchant-service`)
  where the pressure signal is request concurrency and CPU.
- **Asynchronous workers** (settlement, reconciliation, notification, risk, outbox publisher)
  where the pressure signal is *queue depth*. CPU is a terrible proxy here: a worker blocked on a
  slow provider call has low CPU and a growing backlog, so CPU-based scaling would scale down
  exactly when the backlog is worst.

## Decision

- **HPA** on CPU and memory for synchronous services, minimum 2 replicas for anything
  customer-facing so a single pod eviction is never an outage.
- **KEDA** for workers, scaled on broker backlog (Service Bus queue length / Event Hubs lag) with
  `minReplicaCount: 0` or `1` depending on latency requirements.
- **AKS Automatic node autoprovisioning** for cluster capacity.
- **PodDisruptionBudgets** so voluntary disruptions cannot take all replicas at once.
- Scaling is bounded by downstream capacity: a worker's `maxReplicaCount` is chosen against the
  PostgreSQL connection budget, because scaling workers into connection exhaustion converts a
  backlog problem into a database outage. Every service's `pool.max × maxReplicas` must fit the
  server's connection limit.

Pod autoscaling, event-driven autoscaling and node scaling are documented separately, with the
scaling rule and its rationale recorded per workload.

## Alternatives considered

- **CPU-based scaling for workers.** Scales on the wrong signal, as above.
- **Fixed replica counts.** Wastes capacity at idle and fails under burst; also removes the
  demonstration of event-driven autoscaling.
- **Custom metrics adapter instead of KEDA.** More code to reach the same place; KEDA has
  first-class scalers for Service Bus, Event Hubs and Kafka.
- **Scale to zero everywhere.** Cold-start latency is unacceptable for the payment hot path;
  reserved for low-urgency workers such as notifications.
- **VPA alongside HPA.** Conflicting controllers on the same resource; out of scope.

## Trade-offs

- KEDA is an additional cluster component to install, secure (it needs its own identity to read
  queue metrics) and monitor.
- Scale-to-zero workers add cold-start latency to the first message after idle.
- Aggressive scaling can amplify load on PostgreSQL and on the acquirer, so limits and connection
  budgets must be maintained as a coupled pair.
- Autoscaling behaviour must be load-tested (Phase 16) or the thresholds are guesses.

## Consequences

- Each workload scales on the signal that actually reflects its pressure.
- Backlog-driven scaling makes queue depth a primary operational metric with an alert.
- Connection budgeting becomes an explicit, documented constraint tied to autoscaling limits.
- The autoscaling demo (generate load → queue depth rises → KEDA scales workers → nodes scale →
  workload stops → scale-down) is reproducible.
