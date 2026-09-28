@description('Region of the private endpoint.')
param location string

@description('Private endpoint name.')
param name string

@description('Subnet that hosts private endpoints.')
param subnetId string

@description('Resource id of the target.')
param targetResourceId string

@description('Private Link group id, for example postgresqlServer or vault.')
param groupId string

@description('Private DNS zone to register the endpoint in.')
param privateDnsZoneId string

resource endpoint 'Microsoft.Network/privateEndpoints@2025-01-01' = {
  name: name
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-conn'
        properties: {
          privateLinkServiceId: targetResourceId
          groupIds: [
            groupId
          ]
        }
      }
    ]
  }
}

resource dnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-01-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'default'
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output privateEndpointId string = endpoint.id
