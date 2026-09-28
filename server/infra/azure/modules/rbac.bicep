@description('ACR name in this resource group.')
param registryName string

@description('AKS cluster principal that must pull images.')
param aksPrincipalId string

@description('Built-in AcrPull role. Workloads never receive Owner or Contributor.')
param acrPullRoleId string = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, aksPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: aksPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output acrPullAssignmentId string = acrPull.id
