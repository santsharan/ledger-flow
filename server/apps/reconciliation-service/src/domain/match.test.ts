import { describe, expect, it } from 'vitest';
import {
  matchStatements,
  parseCsvStatement,
  parseJsonStatement,
  type ExternalTransaction,
  type InternalTransaction,
} from './match';

function internal(overrides: Partial<InternalTransaction> = {}): InternalTransaction {
  return {
    paymentReference: 'PAY-001',
    providerReference: 'prov-1',
    amountMinor: 10000n,
    currency: 'INR',
    settlementDate: '2026-09-25',
    status: 'CAPTURED',
    ...overrides,
  };
}

function external(overrides: Partial<ExternalTransaction> = {}): ExternalTransaction {
  return {
    externalReference: 'prov-1',
    paymentReference: 'PAY-001',
    amountMinor: 10000n,
    currency: 'INR',
    settlementDate: '2026-09-25',
    status: 'CAPTURED',
    ...overrides,
  };
}

function types(internalRows: InternalTransaction[], externalRows: ExternalTransaction[]): string[] {
  return matchStatements(internalRows, externalRows).map((row) => row.resultType);
}

describe('matchStatements', () => {
  it('matches on provider reference', () => {
    const [row] = matchStatements([internal()], [external()]);
    expect(row).toMatchObject({
      resultType: 'MATCHED',
      matchReason: 'MATCHED_BY_PROVIDER_REFERENCE',
      deltaMinor: 0n,
    });
  });

  it('classifies the demo amount mismatch instead of fixing it', () => {
    const [row] = matchStatements([internal()], [external({ amountMinor: 9900n })]);
    expect(row).toMatchObject({
      resultType: 'AMOUNT_MISMATCH',
      matchReason: 'MATCHED_BY_PROVIDER_REFERENCE',
      deltaMinor: -100n,
    });
  });

  it('covers every mismatch category', () => {
    expect(types([internal({ currency: 'INR' })], [external({ currency: 'USD' })])).toEqual([
      'CURRENCY_MISMATCH',
    ]);
    expect(
      types(
        [internal({ settlementDate: '2026-09-25' })],
        [external({ settlementDate: '2026-09-26' })],
      ),
    ).toEqual(['DATE_MISMATCH']);
    expect(types([internal({ status: 'CAPTURED' })], [external({ status: 'FAILED' })])).toEqual([
      'STATUS_MISMATCH',
    ]);
    expect(types([], [external({ externalReference: 'missing' })])).toEqual(['MISSING_INTERNAL']);
    expect(types([internal()], [])).toEqual(['MISSING_EXTERNAL']);
    expect(
      types(
        [internal(), internal({ paymentReference: 'PAY-002', providerReference: 'prov-2' })],
        [external(), external({ externalReference: 'prov-1', paymentReference: 'PAY-001' })],
      ),
    ).toContain('DUPLICATE_EXTERNAL');
    expect(
      types(
        [
          internal({ providerReference: null }),
          internal({ paymentReference: 'PAY-001', providerReference: null }),
        ],
        [],
      ),
    ).toContain('DUPLICATE_INTERNAL');
  });

  it('matches a unique amount, currency and date when references differ', () => {
    const [row] = matchStatements(
      [internal({ providerReference: null, paymentReference: 'PAY-9' })],
      [external({ externalReference: 'ext-9', paymentReference: null })],
    );
    expect(row).toMatchObject({ resultType: 'MATCHED', matchReason: 'MATCHED_BY_AMOUNT_DATE' });
  });

  it('parses CSV and JSON into the same rows', () => {
    const csv = parseCsvStatement(
      'externalReference,paymentReference,amountMinor,currency,settlementDate,status\nprov-1,PAY-001,10000,INR,2026-09-25,CAPTURED\n',
    );
    const json = parseJsonStatement([
      {
        externalReference: 'prov-1',
        paymentReference: 'PAY-001',
        amountMinor: '10000',
        currency: 'INR',
        settlementDate: '2026-09-25',
        status: 'CAPTURED',
      },
    ]);
    expect(csv).toEqual(json);
  });
});
