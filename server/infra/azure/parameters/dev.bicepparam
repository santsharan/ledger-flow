using '../main.bicep'

param environment = 'dev'
param location = 'centralindia'
param nameSuffix = 'd01'
param postgresVersion = '17'
param postgresAdministratorLogin = 'lfadmin'
param publisherEmail = 'platform-dev@ledgerflow.example'

// postgresAdministratorPassword is @secure() and is intentionally absent.
// Supply it at deployment time:
//   az deployment group create ... --parameters postgresAdministratorPassword="$POSTGRES_ADMIN_PASSWORD"
