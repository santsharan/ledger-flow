@description('Azure region for regional resources.')
param location string

@description('Short prefix used in resource names. Letters and digits only.')
param namePrefix string

@description('Address space for the virtual network.')
param vnetAddressPrefix string

@description('AKS node subnet.')
param aksSubnetPrefix string

@description('Private endpoint subnet.')
param privateEndpointSubnetPrefix string

@description('Management subnet for a jump host. Empty in environments that do not use one.')
param managementSubnetPrefix string

var tags = {
  platform: 'ledgerflow'
  component: 'networking'
}

resource nsgAks 'Microsoft.Network/networkSecurityGroups@2025-01-01' = {
  name: '${namePrefix}-nsg-aks'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-vnet-inbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          destinationPortRange: '*'
        }
      }
      {
        name: 'deny-internet-inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource nsgPrivateEndpoints 'Microsoft.Network/networkSecurityGroups@2025-01-01' = {
  name: '${namePrefix}-nsg-pe'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-vnet-inbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'VirtualNetwork'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
      {
        name: 'deny-internet-inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-01-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        vnetAddressPrefix
      ]
    }
    subnets: [
      {
        name: 'snet-aks'
        properties: {
          addressPrefix: aksSubnetPrefix
          networkSecurityGroup: {
            id: nsgAks.id
          }
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          networkSecurityGroup: {
            id: nsgPrivateEndpoints.id
          }
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        name: 'snet-management'
        properties: {
          addressPrefix: managementSubnetPrefix
        }
      }
    ]
  }
}

// Private DNS zones for data-plane private endpoints (ADR-012).
var dnsZones = [
  'privatelink.postgres.database.azure.com'
  'privatelink.redis.azure.net'
  'privatelink.vaultcore.azure.net'
  'privatelink.servicebus.windows.net'
  'privatelink.azurecr.io'
]

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2024-06-01' = [for zone in dnsZones: {
  name: zone
  location: 'global'
  tags: tags
}]

resource privateDnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [for (zone, i) in dnsZones: {
  parent: privateDnsZones[i]
  name: '${namePrefix}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}]

output vnetId string = vnet.id
output vnetName string = vnet.name
output aksSubnetId string = vnet.properties.subnets[0].id
output privateEndpointSubnetId string = vnet.properties.subnets[1].id
output postgresDnsZoneId string = privateDnsZones[0].id
output redisDnsZoneId string = privateDnsZones[1].id
output keyVaultDnsZoneId string = privateDnsZones[2].id
output serviceBusDnsZoneId string = privateDnsZones[3].id
output acrDnsZoneId string = privateDnsZones[4].id
