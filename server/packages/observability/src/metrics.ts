import { metrics, type Counter } from '@opentelemetry/api';

/**
 * Business and technical metric names from the specification.
 * Auto-instrumentation covers HTTP, PostgreSQL, and outbound HTTP. These counters are the
 * business events the dashboards and alerts read.
 */
export const MetricName = {
  paymentsCreated: 'payments_created_total',
  paymentsAuthorized: 'payments_authorized_total',
  paymentsFailed: 'payments_failed_total',
  paymentsCaptured: 'payments_captured_total',
  refunds: 'refunds_total',
  ledgerJournalsPosted: 'ledger_journals_posted_total',
  ledgerJournalFailures: 'ledger_journal_failures_total',
  settlementsCreated: 'settlements_created_total',
  settlementsCompleted: 'settlements_completed_total',
  reconciliationRuns: 'reconciliation_runs_total',
  reconciliationMismatches: 'reconciliation_mismatches_total',
  riskApproved: 'risk_approved_total',
  riskReview: 'risk_review_total',
  riskDeclined: 'risk_declined_total',
  outboxBacklog: 'outbox_backlog',
  messageConsumed: 'message_consumed_total',
  messageFailed: 'message_failed_total',
  deadLetter: 'dead_letter_total',
} as const;

const meter = metrics.getMeter('ledgerflow');
const counters = new Map<string, Counter>();

export function increment(name: string, attributes?: Record<string, string>): void {
  let counter = counters.get(name);
  if (counter === undefined) {
    counter = meter.createCounter(name);
    counters.set(name, counter);
  }
  counter.add(1, attributes);
}
