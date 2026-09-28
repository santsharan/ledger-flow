@description('Region for the managed identities.')
param location string

@description('Name prefix.')
param namePrefix string

@description('AKS OIDC issuer URL. Comes from the cluster output, not from a static tenant.')
param oidcIssuerUrl string

@description('Kubernetes namespace the service accounts live in.')
param kubernetesNamespace string

@description('Key Vault resource id.')
param keyVaultName string

@description('Service Bus namespace name.')
param serviceBusNamespaceName string

@description('Event Hubs namespace name.')
param eventHubNamespaceName string

var services = [
  'api-gateway'
  'identity-service'
  'merchant-service'
  'payment-service'
  'ledger-service'
  'settlement-service'
  'reconciliation-service'
  'risk-service'
  'notification-service'
]

var kvSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var sbSender = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
var sbReceiver = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'
var ehSender = '2b629674-e913-4c01-ae53-ef4638d8f975'
var ehReceiver = 'a638d3c7-ab3a-418d-83e6-5f17a39d4fde'

resource identities 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = [for service in services: {
  name: '${namePrefix}-${service}'
  location: location
}]

resource federated 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2024-11-30' = [for (service, i) in services: {
  parent: identities[i]
  name: '${service}-aks'
  properties: {
    issuer: oidcIssuerUrl
    subject: 'system:serviceaccount:${kubernetesNamespace}:${service}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}]

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2026-01-01' existing = {
  name: serviceBusNamespaceName
}

resource paymentAuthorization 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'payment-authorization'
}
resource paymentCapture 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'payment-capture'
}
resource paymentRefund 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'payment-refund'
}
resource settlementQueue 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'settlement'
}
resource reconciliationQueue 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'reconciliation'
}
resource notificationQueue 'Microsoft.ServiceBus/namespaces/queues@2026-01-01' existing = {
  parent: serviceBus
  name: 'notification'
}

resource eventHubs 'Microsoft.EventHub/namespaces@2026-01-01' existing = {
  name: eventHubNamespaceName
}
resource paymentEvents 'Microsoft.EventHub/namespaces/eventhubs@2026-01-01' existing = {
  parent: eventHubs
  name: 'payment-events'
}
resource ledgerEvents 'Microsoft.EventHub/namespaces/eventhubs@2026-01-01' existing = {
  parent: eventHubs
  name: 'ledger-events'
}
resource riskEvents 'Microsoft.EventHub/namespaces/eventhubs@2026-01-01' existing = {
  parent: eventHubs
  name: 'risk-events'
}

// Services that read their database password or provider secret from Key Vault.
var keyVaultServices = [
  'identity-service'
  'merchant-service'
  'payment-service'
  'ledger-service'
  'settlement-service'
  'reconciliation-service'
  'risk-service'
  'notification-service'
]

resource keyVaultReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for service in keyVaultServices: {
  name: guid(vault.id, service, kvSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUser)
    principalId: identities[indexOf(services, service)].properties.principalId
    principalType: 'ServicePrincipal'
  }
}]

resource paymentSendAuth 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentAuthorization.id, 'payment-service', sbSender)
  scope: paymentAuthorization
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbSender)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource paymentReceiveAuth 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentAuthorization.id, 'payment-service', sbReceiver)
  scope: paymentAuthorization
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource paymentSendCapture 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentCapture.id, 'payment-service', sbSender)
  scope: paymentCapture
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbSender)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource paymentReceiveCapture 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentCapture.id, 'payment-service', sbReceiver)
  scope: paymentCapture
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource paymentSendRefund 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentRefund.id, 'payment-service', sbSender)
  scope: paymentRefund
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbSender)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource paymentReceiveRefund 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentRefund.id, 'payment-service', sbReceiver)
  scope: paymentRefund
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource settlementSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(settlementQueue.id, 'settlement-service', sbSender)
  scope: settlementQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbSender)
    principalId: identities[indexOf(services, 'settlement-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource settlementReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(settlementQueue.id, 'settlement-service', sbReceiver)
  scope: settlementQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'settlement-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource reconciliationSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(reconciliationQueue.id, 'reconciliation-service', sbSender)
  scope: reconciliationQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbSender)
    principalId: identities[indexOf(services, 'reconciliation-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource reconciliationReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(reconciliationQueue.id, 'reconciliation-service', sbReceiver)
  scope: reconciliationQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'reconciliation-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource notificationReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(notificationQueue.id, 'notification-service', sbReceiver)
  scope: notificationQueue
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', sbReceiver)
    principalId: identities[indexOf(services, 'notification-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource paymentEventsSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentEvents.id, 'payment-service', ehSender)
  scope: paymentEvents
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', ehSender)
    principalId: identities[indexOf(services, 'payment-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource ledgerEventsSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(ledgerEvents.id, 'ledger-service', ehSender)
  scope: ledgerEvents
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', ehSender)
    principalId: identities[indexOf(services, 'ledger-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource ledgerEventsReceive 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(paymentEvents.id, 'ledger-service', ehReceiver)
  scope: paymentEvents
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', ehReceiver)
    principalId: identities[indexOf(services, 'ledger-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource riskEventsSend 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(riskEvents.id, 'risk-service', ehSender)
  scope: riskEvents
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', ehSender)
    principalId: identities[indexOf(services, 'risk-service')].properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output identityClientIds array = [for (service, i) in services: {
  service: service
  clientId: identities[i].properties.clientId
  principalId: identities[i].properties.principalId
}]

output federatedCredentialIds array = [for i in range(0, length(services)): federated[i].id]
output keyVaultAssignmentCount int = length(keyVaultReaders)
