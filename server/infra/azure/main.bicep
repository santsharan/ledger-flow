targetScope = 'resourceGroup'

@description('dev, demo, or prod. Controls SKU and availability choices.')
@allowed([
  'dev'
  'demo'
  'prod'
])
param environment string

@description('Azure region. No subscription or tenant id is hardcoded; those come from the deployment context.')
param location string

@description('Short unique suffix so globally unique names do not collide. Not a secret.')
param nameSuffix string

@description('PostgreSQL major version selected for this environment.')
param postgresVersion string

@description('Non-secret database administrator name.')
param postgresAdministratorLogin string

@description('Deployment-time secret. Do not commit a value. Pass it from the pipeline.')
@secure()
param postgresAdministratorPassword string

@description('API Management publisher contact for this environment.')
param publisherEmail string

var prefix = 'lf${environment}${nameSuffix}'
var postgresHa = environment == 'dev' ? 'Disabled' : 'ZoneRedundant'
var postgresTier = environment == 'dev' ? 'Burstable' : 'GeneralPurpose'
var postgresSku = environment == 'dev' ? 'Standard_B2s' : environment == 'demo' ? 'Standard_D2ds_v5' : 'Standard_D4ds_v5'
var redisSku = environment == 'prod' ? 'Balanced_B1' : 'Balanced_B0'
var eventHubSku = environment == 'prod' ? 'Premium' : 'Standard'
var apimSku = environment == 'dev' ? 'Developer' : environment == 'demo' ? 'Standard' : 'Premium'
var logRetention = environment == 'prod' ? 90 : environment == 'demo' ? 30 : 30
var backupRetention = environment == 'prod' ? 35 : 7

module network 'modules/networking.bicep' = {
  name: 'network'
  params: {
    location: location
    namePrefix: prefix
    vnetAddressPrefix: '10.20.0.0/16'
    aksSubnetPrefix: '10.20.0.0/20'
    privateEndpointSubnetPrefix: '10.20.16.0/24'
    managementSubnetPrefix: '10.20.17.0/24'
  }
}

module registry 'modules/acr.bicep' = {
  name: 'acr'
  params: {
    location: location
    registryName: '${prefix}acr'
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    serverName: '${prefix}-pg'
    postgresVersion: postgresVersion
    skuName: postgresSku
    skuTier: postgresTier
    storageSizeGB: environment == 'prod' ? 128 : 32
    backupRetentionDays: backupRetention
    geoRedundantBackup: environment == 'prod' ? 'Enabled' : 'Disabled'
    highAvailabilityMode: postgresHa
    administratorLogin: postgresAdministratorLogin
    administratorPassword: postgresAdministratorPassword
  }
}

module redis 'modules/redis.bicep' = {
  name: 'redis'
  params: {
    location: location
    cacheName: '${prefix}-redis'
    skuName: redisSku
    highAvailability: environment == 'dev' ? 'Disabled' : 'Enabled'
  }
}

module serviceBus 'modules/servicebus.bicep' = {
  name: 'servicebus'
  params: {
    location: location
    namespaceName: '${prefix}-sb'
    queueNames: [
      'payment-authorization'
      'payment-capture'
      'payment-refund'
      'settlement'
      'reconciliation'
      'notification'
    ]
  }
}

module eventHubs 'modules/eventhubs.bicep' = {
  name: 'eventhubs'
  params: {
    location: location
    namespaceName: '${prefix}-eh'
    skuName: eventHubSku
    hubs: [
      { name: 'payment-events', partitionCount: 4, retentionDays: 7 }
      { name: 'ledger-events', partitionCount: 4, retentionDays: 7 }
      { name: 'audit-events', partitionCount: 2, retentionDays: 7 }
      { name: 'risk-events', partitionCount: 2, retentionDays: 3 }
    ]
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    vaultName: take('${prefix}kv', 24)
  }
}

module monitor 'modules/monitor.bicep' = {
  name: 'monitor'
  params: {
    location: location
    namePrefix: prefix
    retentionInDays: logRetention
  }
}

module aks 'modules/aks.bicep' = {
  name: 'aks'
  params: {
    location: location
    clusterName: '${prefix}-aks'
    privateCluster: environment != 'dev'
    logAnalyticsWorkspaceId: monitor.outputs.workspaceId
  }
}

module frontDoor 'modules/frontdoor.bicep' = {
  name: 'frontdoor'
  params: {
    profileName: '${prefix}-fd'
    wafPolicyName: '${prefix}waf'
  }
}

module apim 'modules/apim.bicep' = {
  name: 'apim'
  params: {
    location: location
    serviceName: '${prefix}-apim'
    skuName: apimSku
    publisherName: 'LedgerFlow'
    publisherEmail: publisherEmail
  }
}

module workloadIdentity 'modules/workload-identity.bicep' = {
  name: 'workload-identity'
  params: {
    location: location
    namePrefix: prefix
    oidcIssuerUrl: aks.outputs.oidcIssuerUrl
    kubernetesNamespace: 'ledgerflow'
    keyVaultName: keyVault.outputs.vaultName
    serviceBusNamespaceName: serviceBus.outputs.namespaceName
    eventHubNamespaceName: eventHubs.outputs.namespaceName
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    namePrefix: prefix
    workspaceId: monitor.outputs.workspaceId
  }
}

module rbac 'modules/rbac.bicep' = {
  name: 'rbac'
  params: {
    registryName: registry.outputs.registryName
    aksPrincipalId: aks.outputs.principalId
  }
}

module postgresEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-postgres'
  params: {
    location: location
    name: '${prefix}-pe-pg'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: postgres.outputs.serverId
    groupId: 'postgresqlServer'
    privateDnsZoneId: network.outputs.postgresDnsZoneId
  }
}

module redisEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-redis'
  params: {
    location: location
    name: '${prefix}-pe-redis'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: redis.outputs.cacheId
    groupId: 'redisEnterprise'
    privateDnsZoneId: network.outputs.redisDnsZoneId
  }
}

module keyVaultEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-keyvault'
  params: {
    location: location
    name: '${prefix}-pe-kv'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: keyVault.outputs.vaultId
    groupId: 'vault'
    privateDnsZoneId: network.outputs.keyVaultDnsZoneId
  }
}

module serviceBusEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-servicebus'
  params: {
    location: location
    name: '${prefix}-pe-sb'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: serviceBus.outputs.namespaceId
    groupId: 'namespace'
    privateDnsZoneId: network.outputs.serviceBusDnsZoneId
  }
}

module eventHubsEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-eventhubs'
  params: {
    location: location
    name: '${prefix}-pe-eh'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: eventHubs.outputs.namespaceId
    groupId: 'namespace'
    privateDnsZoneId: network.outputs.serviceBusDnsZoneId
  }
}

module acrEndpoint 'modules/private-endpoint.bicep' = {
  name: 'pe-acr'
  params: {
    location: location
    name: '${prefix}-pe-acr'
    subnetId: network.outputs.privateEndpointSubnetId
    targetResourceId: registry.outputs.registryId
    groupId: 'registry'
    privateDnsZoneId: network.outputs.acrDnsZoneId
  }
}

// Outputs consumed by CI/CD. No secrets except the secure App Insights connection string.
output environmentName string = environment
output aksClusterName string = aks.outputs.clusterName
output aksClusterId string = aks.outputs.clusterId
output aksOidcIssuerUrl string = aks.outputs.oidcIssuerUrl
output aksPrincipalId string = aks.outputs.principalId
output acrName string = registry.outputs.registryName
output acrLoginServer string = registry.outputs.loginServer
output acrId string = registry.outputs.registryId
output postgresServerName string = postgres.outputs.serverName
output postgresFqdn string = postgres.outputs.fqdn
output postgresServerId string = postgres.outputs.serverId
output redisHostName string = redis.outputs.hostName
output redisId string = redis.outputs.cacheId
output serviceBusNamespaceName string = serviceBus.outputs.namespaceName
output serviceBusNamespaceId string = serviceBus.outputs.namespaceId
output eventHubNamespaceName string = eventHubs.outputs.namespaceName
output eventHubNamespaceId string = eventHubs.outputs.namespaceId
output keyVaultName string = keyVault.outputs.vaultName
output keyVaultUri string = keyVault.outputs.vaultUri
output keyVaultId string = keyVault.outputs.vaultId
output logAnalyticsWorkspaceId string = monitor.outputs.workspaceId
output appInsightsName string = monitor.outputs.appInsightsName
@secure()
output appInsightsConnectionString string = monitor.outputs.appInsightsConnectionString
output prometheusAccountId string = monitor.outputs.prometheusId
output frontDoorProfileName string = frontDoor.outputs.profileName
output frontDoorId string = frontDoor.outputs.profileId
output apimName string = apim.outputs.serviceName
output apimGatewayUrl string = apim.outputs.gatewayUrl
output acrPullAssignmentId string = rbac.outputs.acrPullAssignmentId
output workloadIdentityClientIds array = workloadIdentity.outputs.identityClientIds
output privateEndpointIds array = [
  postgresEndpoint.outputs.privateEndpointId
  redisEndpoint.outputs.privateEndpointId
  keyVaultEndpoint.outputs.privateEndpointId
  serviceBusEndpoint.outputs.privateEndpointId
  eventHubsEndpoint.outputs.privateEndpointId
  acrEndpoint.outputs.privateEndpointId
]
