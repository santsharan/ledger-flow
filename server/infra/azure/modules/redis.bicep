@description('Region.')
param location string

@description('Azure Managed Redis (Redis Enterprise) name.')
param cacheName string

@description('SKU such as Balanced_B0 for non-prod and Balanced_B1 for prod.')
param skuName string

@description('Enabled in demo and prod. Disabled in dev.')
param highAvailability string

resource cache 'Microsoft.Cache/redisEnterprise@2025-07-01' = {
  name: cacheName
  location: location
  sku: {
    name: skuName
  }
  properties: {
    minimumTlsVersion: '1.2'
    highAvailability: highAvailability
    publicNetworkAccess: 'Disabled'
  }
}

resource database 'Microsoft.Cache/redisEnterprise/databases@2025-07-01' = {
  parent: cache
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    port: 10000
    clusteringPolicy: 'OSSCluster'
    // Financial correctness does not use Redis as a cache of record. Eviction must not
    // silently drop idempotency hints if a caller ever stores them here.
    evictionPolicy: 'NoEviction'
    accessKeysAuthentication: 'Enabled'
  }
}

output cacheId string = cache.id
output hostName string = cache.properties.hostName
output databaseId string = database.id
