# Azure infrastructure

Bicep for LedgerFlow. This tree is validated with `bicep build`. It is not deployed from this repository automatically.

## Layout

| Path | Purpose |
| --- | --- |
| `main.bicep` | Resource-group deployment. Wires every module and publishes CI outputs. |
| `modules/` | Networking, AKS Automatic, ACR, PostgreSQL, Managed Redis, Service Bus, Event Hubs, Key Vault, Monitor, Front Door, API Management, RBAC, private endpoints |
| `parameters/` | `dev`, `demo`, and `prod`. No secrets. |

## What is not in source control

`postgresAdministratorPassword` is a `@secure()` parameter with no default and no value in the parameter files. Pass it from the pipeline secret store at deployment time. Tenant and subscription ids come from the deployment context (`tenant()`, the selected subscription), not from the templates.

## Validate

```bash
bicep build infra/azure/main.bicep --outfile /tmp/ledgerflow-main.json
```

## Environments

| | dev | demo | prod |
| --- | --- | --- | --- |
| PostgreSQL HA | off | zone-redundant | zone-redundant |
| PostgreSQL tier | Burstable | General Purpose | General Purpose |
| AKS API server | public | private | private |
| Redis HA | off | on | on |
| Event Hubs | Standard | Standard | Premium |
| API Management | Developer | Standard | Premium |

Data stores are created with public network access disabled and a private endpoint. Workload identities and the permission matrix are added in the security phase.
