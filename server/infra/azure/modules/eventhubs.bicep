@description('Region.')
param location string

@description('Event Hubs namespace name.')
param namespaceName string

@description('Standard or Premium.')
param skuName string

@description('Hub definitions: name and partition count.')
param hubs array

resource namespace 'Microsoft.EventHub/namespaces@2026-01-01' = {
  name: namespaceName
  location: location
  sku: {
    name: skuName
    tier: skuName
    capacity: 1
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    isAutoInflateEnabled: false
  }
}

resource hubsResources 'Microsoft.EventHub/namespaces/eventhubs@2026-01-01' = [for hub in hubs: {
  parent: namespace
  name: hub.name
  properties: {
    partitionCount: hub.partitionCount
    messageRetentionInDays: hub.retentionDays
  }
}]

resource consumerGroups 'Microsoft.EventHub/namespaces/eventhubs/consumergroups@2026-01-01' = [for (hub, i) in hubs: {
  parent: hubsResources[i]
  name: 'ledgerflow'
}]

output namespaceId string = namespace.id
output namespaceName string = namespace.name
output hubIds array = [for (hub, i) in hubs: hubsResources[i].id]
