@description('Region.')
param location string

@description('Service Bus namespace name.')
param namespaceName string

@description('Workflow queues. Dead-lettering is a property of each queue, not a separate queue.')
param queueNames array

resource namespace 'Microsoft.ServiceBus/namespaces@2026-01-01' = {
  name: namespaceName
  location: location
  sku: {
    name: 'Premium'
    tier: 'Premium'
    capacity: 1
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    disableLocalAuth: true
    premiumMessagingPartitions: 1
  }
}

resource queues 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' = [for queueName in queueNames: {
  parent: namespace
  name: queueName
  properties: {
    lockDuration: 'PT1M'
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
  }
}]

output namespaceId string = namespace.id
output namespaceName string = namespace.name
output queueIds array = [for (queueName, i) in queueNames: queues[i].id]
