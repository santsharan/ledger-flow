@description('Region.')
param location string

@description('Globally unique registry name. Alphanumeric only.')
param registryName string

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Disabled'
    zoneRedundancy: 'Disabled'
    policies: {
      retentionPolicy: {
        status: 'enabled'
        days: 30
      }
      trustPolicy: {
        type: 'Notary'
        status: 'enabled'
      }
    }
  }
}

output registryId string = registry.id
output loginServer string = registry.properties.loginServer
output registryName string = registry.name
