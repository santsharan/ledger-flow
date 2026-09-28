# ADR-012: Private networking for all data services

Status: Accepted
Date: 2026-09-25

## Context

PostgreSQL holds the financial source of truth; Key Vault holds secrets; Service Bus and Event
Hubs carry financial commands and events. Exposing any of them on a public endpoint means their
security rests entirely on credentials and firewall rules, and a leaked credential becomes
immediately exploitable from anywhere on the internet.

## Decision

All data-plane services are reachable only over **Private Endpoints** inside the VNet, with public
network access disabled:

| Service | Access |
| --- | --- |
| PostgreSQL Flexible Server | Private endpoint, public access disabled, TLS required |
| Azure Managed Redis | Private endpoint |
| Key Vault | Private endpoint, RBAC authorization mode |
| Service Bus (Premium) | Private endpoint |
| Event Hubs | Private endpoint |
| Container Registry (Premium) | Private endpoint |

Name resolution uses **Private DNS Zones** linked to the VNet. Subnets are segmented
(`snet-aks`, `snet-private-endpoints`, `snet-management`) with NSGs, and Kubernetes
**NetworkPolicies default-deny** pod-to-pod traffic, opening only the paths the architecture
requires.

Ingress is the only public surface: Front Door Premium with WAF in front of API Management, which
fronts the gateway. Egress to the acquirer simulator is explicitly allowed and everything else is
denied by policy.

## Alternatives considered

- **Public endpoints with IP firewall rules.** Fragile (AKS egress IPs change with scaling),
  and a credential leak is directly exploitable.
- **Service endpoints instead of private endpoints.** Traffic stays on the Azure backbone but the
  resource keeps a public DNS identity and public access path; private endpoints give a private IP
  and allow public access to be fully disabled.
- **VNet-injected everything with no private endpoints.** Not supported uniformly across the
  services used here.
- **Flat pod network with no NetworkPolicies.** Would mean any compromised pod can reach the
  database directly.

## Trade-offs

- Private DNS misconfiguration is the single most common cause of "it resolves but times out";
  this needs a runbook and a smoke test.
- Developer access to production data requires a bastion/jump path or Azure-hosted tooling, which
  is intentional friction.
- CI cannot reach private resources directly, so migrations run as in-cluster jobs rather than
  from the pipeline runner.
- More Azure resources (endpoints, zones, links) and therefore more Bicep.

## Consequences

- The blast radius of a leaked credential is limited to callers already inside the network.
- "Inside the cluster" is still not trusted — service-to-service auth remains mandatory (see
  trust boundaries).
- Network reachability becomes part of the deployment verification, not an afterthought.
