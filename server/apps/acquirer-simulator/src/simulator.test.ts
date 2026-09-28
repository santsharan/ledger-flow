import { describe, expect, it } from 'vitest';
import { AcquirerSimulator, ProviderTransportError } from './simulator';

const request = {
  attemptId: 'attempt-1',
  paymentId: 'pay-1',
  operation: 'AUTHORIZE' as const,
  amountMinor: 10000n,
  currency: 'INR',
};

describe('AcquirerSimulator', () => {
  it('approves and returns the same provider reference for a repeated attempt', async () => {
    const simulator = new AcquirerSimulator('SUCCESS');

    const first = await simulator.execute(request);
    const second = await simulator.execute(request);

    expect(first).toEqual(second);
    const stored = simulator.lookup(request.attemptId);
    expect(first.outcome).toBe('APPROVED');
    expect(stored?.outcome).toBe('APPROVED');
    if (first.outcome === 'APPROVED' && stored?.outcome === 'APPROVED') {
      expect(stored.providerReference).toBe(first.providerReference);
    }
  });

  it('processes a timeout and then withholds the response', async () => {
    const simulator = new AcquirerSimulator('TIMEOUT');

    await expect(simulator.execute(request)).rejects.toBeInstanceOf(ProviderTransportError);

    const stored = simulator.lookup(request.attemptId);
    expect(stored?.outcome).toBe('APPROVED');
  });

  it('does not store a transient failure, and does store a permanent decline', async () => {
    const transient = new AcquirerSimulator('TRANSIENT_FAILURE');
    const declined = await transient.execute(request);
    expect(declined.outcome).toBe('DECLINED');
    expect(transient.lookup(request.attemptId)).toBeNull();

    const permanent = new AcquirerSimulator('PERMANENT_FAILURE');
    expect((await permanent.execute(request)).outcome).toBe('DECLINED');
    expect(permanent.lookup(request.attemptId)?.outcome).toBe('DECLINED');
  });

  it('returns a wrong amount without changing the stored approved amount on lookup after success mode', async () => {
    const simulator = new AcquirerSimulator('WRONG_AMOUNT');
    const result = await simulator.execute(request);

    expect(result.outcome).toBe('APPROVED');
    if (result.outcome === 'APPROVED') {
      expect(result.amountMinor).toBe(9999n);
    }
  });

  it('builds settlement files according to the active mode', () => {
    const captures = [{ paymentId: 'pay-1', amountMinor: 10000n, currency: 'INR' }];

    expect(new AcquirerSimulator('SUCCESS').settlementFile(captures)).toEqual([
      { paymentId: 'pay-1', amountMinor: 10000n, currency: 'INR', providerReference: 'stl_pay-1' },
    ]);
    expect(new AcquirerSimulator('MISSING_SETTLEMENT').settlementFile(captures)).toEqual([]);
    expect(new AcquirerSimulator('DUPLICATE_SETTLEMENT').settlementFile(captures)).toHaveLength(2);
    expect(new AcquirerSimulator('WRONG_AMOUNT').settlementFile(captures)[0]?.amountMinor).toBe(9900n);
    expect(new AcquirerSimulator('WRONG_CURRENCY').settlementFile(captures)[0]?.currency).toBe('USD');
  });
});
