@description('Region.')
param location string

@description('Name prefix.')
param namePrefix string

@description('Log Analytics workspace that receives application traces.')
param workspaceId string

@description('Action group resource id. Empty skips notification actions.')
param actionGroupId string = ''

var scopes = [
  workspaceId
]

resource ledgerPostingFailures 'Microsoft.Insights/scheduledQueryRules@2026-03-01' = {
  name: '${namePrefix}-ledger-posting-failures'
  location: location
  properties: {
    displayName: 'Ledger posting failures'
    description: 'A ledger journal failed to post. Financial movement may be stuck.'
    severity: 1
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: scopes
    criteria: {
      allOf: [
        {
          query: 'AppTraces | where Message has "ledger" and (Message has "fail" or Message has "drift")'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: actionGroupId == '' ? null : {
      actionGroups: [
        actionGroupId
      ]
    }
  }
}

resource providerUnknown 'Microsoft.Insights/scheduledQueryRules@2026-03-01' = {
  name: '${namePrefix}-authorization-unknown'
  location: location
  properties: {
    displayName: 'Authorization unknown outcomes'
    description: 'Provider responses are being lost. Payments are sitting in an unknown state.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: scopes
    criteria: {
      allOf: [
        {
          query: 'AppTraces | where Message has "payment.provider.unknown" | summarize count()'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 5
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
  }
}

resource reconciliationSpike 'Microsoft.Insights/scheduledQueryRules@2026-03-01' = {
  name: '${namePrefix}-reconciliation-mismatches'
  location: location
  properties: {
    displayName: 'Reconciliation mismatch spike'
    description: 'Mismatch cases are being opened faster than the recent baseline.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    scopes: scopes
    criteria: {
      allOf: [
        {
          query: 'AppTraces | where Message has "reconciliation" and Message has "mismatch"'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 20
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
  }
}

output alertRuleIds array = [
  ledgerPostingFailures.id
  providerUnknown.id
  reconciliationSpike.id
]
