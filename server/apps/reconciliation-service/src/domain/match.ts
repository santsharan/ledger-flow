export const RESULT_TYPES = [
  'MATCHED',
  'MISSING_INTERNAL',
  'MISSING_EXTERNAL',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'DUPLICATE_EXTERNAL',
  'DUPLICATE_INTERNAL',
  'DATE_MISMATCH',
  'STATUS_MISMATCH',
] as const;

export type ReconciliationResultType = (typeof RESULT_TYPES)[number];

export type MatchReason =
  'MATCHED_BY_PROVIDER_REFERENCE' | 'MATCHED_BY_PAYMENT_REFERENCE' | 'MATCHED_BY_AMOUNT_DATE';

export interface InternalTransaction {
  readonly paymentReference: string;
  readonly providerReference: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly settlementDate: string;
  readonly status: string;
}

export interface ExternalTransaction {
  readonly externalReference: string;
  readonly paymentReference: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly settlementDate: string;
  readonly status: string;
}

export interface MatchResult {
  readonly resultType: ReconciliationResultType;
  readonly matchReason: MatchReason | null;
  readonly internalReference: string | null;
  readonly externalReference: string | null;
  readonly deltaMinor: bigint | null;
}

/**
 * Deterministic matcher. The first applicable rule wins, and an ambiguous group is never guessed.
 * A reference match that disagrees on amount, currency, date or status is a typed mismatch,
 * not a fallback to a looser rule.
 */
export function matchStatements(
  internal: readonly InternalTransaction[],
  external: readonly ExternalTransaction[],
): MatchResult[] {
  const results: MatchResult[] = [];
  const consumedInternal = new Set<string>();
  const consumedExternal = new Set<number>();

  const duplicateExternalRefs = duplicates(external.map((row) => row.externalReference));
  const duplicateInternalRefs = duplicates(internal.map((row) => row.paymentReference));

  external.forEach((row, index) => {
    if (duplicateExternalRefs.has(row.externalReference)) {
      results.push(result('DUPLICATE_EXTERNAL', null, null, row.externalReference, null));
      consumedExternal.add(index);
    }
  });
  internal.forEach((row) => {
    if (duplicateInternalRefs.has(row.paymentReference)) {
      results.push(result('DUPLICATE_INTERNAL', null, row.paymentReference, null, null));
      consumedInternal.add(row.paymentReference);
    }
  });

  const internalByProvider = indexBy(internal, (row) => row.providerReference, consumedInternal);
  const internalByPayment = indexBy(internal, (row) => row.paymentReference, consumedInternal);

  external.forEach((row, index) => {
    if (consumedExternal.has(index)) return;

    const byProvider =
      row.externalReference === '' ? undefined : internalByProvider.get(row.externalReference);
    const byPayment =
      row.paymentReference === null ? undefined : internalByPayment.get(row.paymentReference);

    const chosen =
      byProvider?.length === 1
        ? { internal: byProvider[0]!, reason: 'MATCHED_BY_PROVIDER_REFERENCE' as const }
        : byPayment?.length === 1
          ? { internal: byPayment[0]!, reason: 'MATCHED_BY_PAYMENT_REFERENCE' as const }
          : null;

    if (chosen !== undefined && chosen !== null) {
      consumedInternal.add(chosen.internal.paymentReference);
      consumedExternal.add(index);
      results.push(classify(chosen.internal, row, chosen.reason));
    }
  });

  const unmatchedExternal = external.filter((_, index) => !consumedExternal.has(index));
  const unmatchedInternal = internal.filter((row) => !consumedInternal.has(row.paymentReference));
  const amountKeyCount = countKeys(unmatchedExternal, amountKey);
  const internalAmountCount = countKeys(unmatchedInternal, (row) => amountKey(row));

  for (const row of unmatchedExternal) {
    const key = amountKey(row);
    const candidates = unmatchedInternal.filter(
      (candidate) =>
        !consumedInternal.has(candidate.paymentReference) && amountKey(candidate) === key,
    );
    if (
      amountKeyCount.get(key) === 1 &&
      internalAmountCount.get(key) === 1 &&
      candidates.length === 1
    ) {
      const candidate = candidates[0]!;
      consumedInternal.add(candidate.paymentReference);
      results.push(classify(candidate, row, 'MATCHED_BY_AMOUNT_DATE'));
      continue;
    }
    results.push(result('MISSING_INTERNAL', null, null, row.externalReference, row.amountMinor));
  }

  for (const row of unmatchedInternal) {
    if (consumedInternal.has(row.paymentReference)) continue;
    results.push(result('MISSING_EXTERNAL', null, row.paymentReference, null, row.amountMinor));
  }

  return results;
}

export function parseJsonStatement(body: unknown): ExternalTransaction[] {
  if (!Array.isArray(body)) {
    throw new Error('JSON statement must be an array.');
  }
  return body.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      externalReference: asText(value.externalReference),
      paymentReference:
        value.paymentReference === undefined || value.paymentReference === null
          ? null
          : asText(value.paymentReference),
      amountMinor: BigInt(asText(value.amountMinor, '0')),
      currency: asText(value.currency),
      settlementDate: asText(value.settlementDate),
      status: asText(value.status),
    };
  });
}

export function parseCsvStatement(csv: string): ExternalTransaction[] {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const header = lines[0]?.split(',').map((cell) => cell.trim()) ?? [];
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const record = Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
    return {
      externalReference: record.externalReference ?? '',
      paymentReference: record.paymentReference === '' ? null : (record.paymentReference ?? null),
      amountMinor: BigInt(record.amountMinor ?? '0'),
      currency: record.currency ?? '',
      settlementDate: record.settlementDate ?? '',
      status: record.status ?? '',
    };
  });
}

function classify(
  internal: InternalTransaction,
  external: ExternalTransaction,
  reason: MatchReason,
): MatchResult {
  if (internal.currency !== external.currency) {
    return result(
      'CURRENCY_MISMATCH',
      reason,
      internal.paymentReference,
      external.externalReference,
      null,
    );
  }
  if (internal.amountMinor !== external.amountMinor) {
    return result(
      'AMOUNT_MISMATCH',
      reason,
      internal.paymentReference,
      external.externalReference,
      external.amountMinor - internal.amountMinor,
    );
  }
  if (internal.settlementDate !== external.settlementDate) {
    return result(
      'DATE_MISMATCH',
      reason,
      internal.paymentReference,
      external.externalReference,
      0n,
    );
  }
  if (internal.status !== external.status) {
    return result(
      'STATUS_MISMATCH',
      reason,
      internal.paymentReference,
      external.externalReference,
      0n,
    );
  }
  return result('MATCHED', reason, internal.paymentReference, external.externalReference, 0n);
}

function result(
  resultType: ReconciliationResultType,
  matchReason: MatchReason | null,
  internalReference: string | null,
  externalReference: string | null,
  deltaMinor: bigint | null,
): MatchResult {
  return { resultType, matchReason, internalReference, externalReference, deltaMinor };
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : fallback;
}

function duplicates(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (value === '') continue;
    if (seen.has(value)) duplicated.add(value);
    seen.add(value);
  }
  return duplicated;
}

function indexBy(
  rows: readonly InternalTransaction[],
  keyOf: (row: InternalTransaction) => string | null,
  skip: ReadonlySet<string>,
): Map<string, InternalTransaction[]> {
  const map = new Map<string, InternalTransaction[]>();
  for (const row of rows) {
    if (skip.has(row.paymentReference)) continue;
    const key = keyOf(row);
    if (key === null || key === '') continue;
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }
  return map;
}

function amountKey(row: { amountMinor: bigint; currency: string; settlementDate: string }): string {
  return `${row.amountMinor.toString()}|${row.currency}|${row.settlementDate}`;
}

function countKeys<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
