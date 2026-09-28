import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';

export const CASE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'ESCALATED',
  'RESOLVED',
  'IGNORED_WITH_REASON',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  OPEN: ['INVESTIGATING', 'ESCALATED', 'IGNORED_WITH_REASON'],
  INVESTIGATING: ['RESOLVED', 'ESCALATED'],
  ESCALATED: ['RESOLVED', 'IGNORED_WITH_REASON'],
  RESOLVED: [],
  IGNORED_WITH_REASON: [],
};

export function assertCaseTransition(from: CaseStatus, to: CaseStatus, reason: string): void {
  if (reason.trim().length < 3) {
    throw new BusinessConflictError(ErrorCode.RESOLUTION_REASON_REQUIRED, 'A reason is required.');
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new BusinessConflictError(
      ErrorCode.INVALID_CASE_STATE_TRANSITION,
      `Case cannot move from ${from} to ${to}.`,
      {
        from,
        to,
        allowed: TRANSITIONS[from],
      },
    );
  }
}
