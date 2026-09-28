# Scaling rules

Synchronous APIs use the Horizontal Pod Autoscaler on CPU. Asynchronous notification work
uses KEDA on Service Bus queue depth. A deployment is never controlled by both.

| Workload | Controller | Min | Max | Signal | Why |
| --- | --- | --- | --- | --- | --- |
| api-gateway | HPA | 2 | 10 | CPU 70% | Customer entry. Two replicas survive one eviction. |
| identity-service | HPA | 2 | 6 | CPU 70% | Token checks are on the request path. |
| merchant-service | HPA | 2 | 6 | CPU 70% | Read on payment creation. |
| payment-service | HPA | 2 | 10 | CPU 70% | Payment API. |
| ledger-service | HPA | 2 | 8 | CPU 70% | Posting and balance reads. |
| settlement-service | HPA | 2 | 6 | CPU 70% | Also serves the settlement API, so it stays on CPU rather than sharing a scaler with a queue. |
| reconciliation-service | HPA | 2 | 6 | CPU 70% | Serves the operator API. |
| risk-service | HPA | 2 | 6 | CPU 70% | Synchronous decision on the payment path. |
| notification-service | KEDA | 1 | 10 | `notification` queue length, 5 messages per replica | No request path. Scale on backlog. |
| acquirer-simulator | none | 1 | 1 | — | Demo dependency. Not scaled. |

Pod disruption budgets keep `minAvailable: 1` wherever the minimum is 2, so a voluntary
drain cannot take the last replica.

`terminationGracePeriodSeconds` is 30. Readiness fails as soon as shutdown starts, then
in-flight database work is allowed to commit. Messages are not acknowledged before that
commit.

These manifests were not applied to a cluster. Probe paths, replica counts, and the
shutdown hook are what a rollout would run. A live pod-restart check needs the Azure
deployment, which this phase does not perform.
