@description('Region.')
param location string

@description('Flexible Server name.')
param serverName string

@description('PostgreSQL major version. Overridable per environment; not pinned in application code.')
param postgresVersion string

@description('SKU name, for example Standard_D2ds_v5.')
param skuName string

@description('SKU tier: Burstable or GeneralPurpose.')
param skuTier string

@description('Storage size in GB.')
param storageSizeGB int

@description('Backup retention in days.')
param backupRetentionDays int

@description('Enabled or Disabled.')
param geoRedundantBackup string

@description('Disabled or ZoneRedundant. Same-zone is not used.')
param highAvailabilityMode string

@description('Non-secret administrator login. The password is a secure parameter and is never stored in source.')
param administratorLogin string

@description('Supplied at deployment time from the pipeline secret store. Not committed.')
@secure()
param administratorPassword string

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: {
      storageSizeGB: storageSizeGB
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: {
      mode: highAvailabilityMode
    }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
      tenantId: tenant().tenantId
    }
    network: {
      publicNetworkAccess: 'Disabled'
    }
    maintenanceWindow: {
      customWindow: 'Enabled'
      dayOfWeek: 0
      startHour: 2
      startMinute: 0
    }
  }
}

output serverId string = server.id
output serverName string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
