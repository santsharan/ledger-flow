@description('Region.')
param location string

@description('API Management service name.')
param serviceName string

@description('Developer, Standard, or Premium.')
param skuName string

@description('Publisher display name. Not a secret.')
param publisherName string

@description('Publisher contact. Not a secret; supplied per environment.')
param publisherEmail string

resource service 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: serviceName
  location: location
  sku: {
    name: skuName
    capacity: 1
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
    publicNetworkAccess: skuName == 'Premium' ? 'Disabled' : 'Enabled'
    virtualNetworkType: 'None'
  }
}

output serviceId string = service.id
output serviceName string = service.name
output gatewayUrl string = service.properties.gatewayUrl
output principalId string = service.identity.principalId
