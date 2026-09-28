# Azure permission matrix

Workload identities are user-assigned managed identities federated to the Kubernetes service
account `ledgerflow/<service>`. None of them is Owner or Contributor. Image pull uses the AKS
cluster identity and `AcrPull` on the registry only.

Built-in data-plane roles are assigned on the queue or hub, not on the resource group.
Key Vault uses RBAC. `Key Vault Secrets User` is the narrowest built-in role that can read
secrets; it is still vault-scoped. Secret-level conditions are a follow-up, not a reason to
grant a broader role.

PostgreSQL access is a database role per service (`payment_app`, `ledger_app`, …), not an
Azure control-plane role. Those roles are created by the local init scripts and must be
created the same way on Flexible Server. A service identity is not a PostgreSQL superuser.

| Service | Resource | Role | Reason |
| --- | --- | --- | --- |
| AKS cluster identity | Container Registry | AcrPull | Nodes pull images. Workloads do not. |
| api-gateway | — | none | No Azure data-plane access. Authentication is the request token. |
| identity-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| merchant-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| payment-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| payment-service | queue `payment-authorization` | Service Bus Data Sender, Data Receiver | Publish and consume authorization commands. Peek-lock, not a namespace-wide grant. |
| payment-service | queue `payment-capture` | Service Bus Data Sender, Data Receiver | Capture commands. |
| payment-service | queue `payment-refund` | Service Bus Data Sender, Data Receiver | Refund commands. |
| payment-service | hub `payment-events` | Event Hubs Data Sender | Publish payment facts. |
| ledger-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| ledger-service | hub `ledger-events` | Event Hubs Data Sender | Publish ledger facts. |
| ledger-service | hub `payment-events` | Event Hubs Data Receiver | Consume capture and refund facts. |
| settlement-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| settlement-service | queue `settlement` | Service Bus Data Sender, Data Receiver | Settlement work items. |
| reconciliation-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| reconciliation-service | queue `reconciliation` | Service Bus Data Sender, Data Receiver | Reconciliation jobs. |
| risk-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| risk-service | hub `risk-events` | Event Hubs Data Sender | Publish risk signals. |
| notification-service | Key Vault | Key Vault Secrets User | Read the database credential material. |
| notification-service | queue `notification` | Service Bus Data Receiver | Consume notification jobs. It does not publish commands. |
| acquirer-simulator | — | none | Demo process. No Azure data-plane role. |

Service Bus duplicate detection is enabled with a 10-minute window. That window is not a
substitute for the inbox. Application idempotency remains the guarantee.

## Explicitly not granted

- Owner, Contributor, User Access Administrator
- Key Vault Administrator (write and purge)
- AcrPush on workload identities
- Namespace-wide Service Bus or Event Hubs data roles
- Reader on the resource group
