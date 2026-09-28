@description('Region.')
param location string

@description('Cluster name.')
param clusterName string

@description('When true, the API server has no public endpoint.')
param privateCluster bool

@description('Log Analytics workspace that receives container logs.')
param logAnalyticsWorkspaceId string

resource cluster 'Microsoft.ContainerService/managedClusters@2025-09-01' = {
  name: clusterName
  location: location
  sku: {
    name: 'Automatic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    oidcIssuerProfile: {
      enabled: true
    }
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
    apiServerAccessProfile: {
      enablePrivateCluster: privateCluster
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
    }
  }
}

output clusterId string = cluster.id
output clusterName string = cluster.name
output principalId string = cluster.identity.principalId
output oidcIssuerUrl string = cluster.properties.oidcIssuerProfile.issuerURL
