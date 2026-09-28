# ADR-011: Workload Identity over static credentials

Status: Accepted
Date: 2026-09-25

## Context

Workloads need to reach Key Vault, Service Bus, Event Hubs, ACR and PostgreSQL. The traditional
approach stores an app registration's client secret in a Kubernetes Secret or environment
variable. That secret is long-lived, copied into CI, visible to anyone with namespace read access,
rotated rarely, and leaks into logs and backups.

## Decision

Use **AKS Workload Identity**: each service's Kubernetes ServiceAccount is federated to a
user-assigned managed identity. The pod receives a short-lived projected token, exchanges it for
an Entra ID token, and calls Azure with no stored secret.

- One managed identity per service — not one shared identity for the cluster.
- Azure RBAC scoped to the specific resources each service uses (a named queue, a named secret),
  not the whole namespace/resource group.
- Key Vault is accessed via the Secrets Store CSI driver using the same identity.
- PostgreSQL uses Entra ID authentication where supported, otherwise a Key Vault-stored password
  fetched at startup with no on-disk persistence.
- GitHub Actions uses OIDC federation to Azure; no long-lived Azure credentials in GitHub.
- No workload identity is ever granted Owner or Contributor.

Every role assignment is recorded in a permission matrix (`service → resource → role → reason`)
produced in Phase 12 and reviewed for removals.

## Alternatives considered

- **Service principal client secrets in Kubernetes Secrets.** Long-lived, widely readable,
  hard to rotate, easy to leak. Rejected.
- **AAD Pod Identity.** The predecessor mechanism; deprecated in favour of Workload Identity.
- **Kubernetes-node managed identity (shared).** Any pod on the node inherits it, which destroys
  per-service least privilege.
- **Secrets only in environment variables from a secret store at deploy time.** Still materializes
  a long-lived secret and couples rotation to redeployment.

## Trade-offs

- More Azure objects to manage (identity + federated credential per service), which is a Bicep and
  naming-convention concern.
- Local development cannot use Workload Identity, so the configuration layer must support both a
  local `.env` path and an Azure identity path — an abstraction that must not diverge in behaviour.
- Token exchange adds a startup dependency on Entra ID availability.

## Consequences

- No static Azure credentials exist in the repository, in CI, or in the cluster.
- A compromised pod can reach only the resources its own identity was granted.
- Rotation is handled by the platform rather than by a runbook.
- Least privilege is auditable: the permission matrix is a reviewable artifact.
