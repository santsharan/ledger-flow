import { describe, expect, it } from 'vitest';
import {
  EventType,
  MalformedEventError,
  UnsupportedEventVersionError,
  createEnvelope,
  ledgerFlowRegistry,
} from './index';

describe('event contracts', () => {
  it('round-trips a versioned PaymentCaptured envelope', () => {
    const registry = ledgerFlowRegistry();
    const envelope = createEnvelope({
      eventType: EventType.PaymentCaptured,
      eventVersion: 1,
      producer: 'payment-service',
      aggregateType: 'payment',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {
        paymentId: '11111111-1111-4111-8111-111111111111',
        merchantId: '22222222-2222-4222-8222-222222222222',
        amountMinor: '10000',
        currency: 'INR',
        attemptId: '33333333-3333-4333-8333-333333333333',
      },
    });

    expect(registry.parse(envelope).payload).toEqual(envelope.payload);
  });

  it('rejects a malformed envelope before any consumer runs', () => {
    expect(() => ledgerFlowRegistry().parse({ eventType: 'PaymentCaptured' })).toThrow(
      MalformedEventError,
    );
  });

  it('rejects a payload that does not match the registered version', () => {
    const envelope = createEnvelope({
      eventType: EventType.PaymentCaptured,
      eventVersion: 1,
      producer: 'payment-service',
      aggregateType: 'payment',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: { paymentId: 'not-a-uuid' },
    });

    expect(() => ledgerFlowRegistry().parse(envelope)).toThrow(MalformedEventError);
  });

  it('rejects an incompatible event version instead of applying it', () => {
    const envelope = createEnvelope({
      eventType: EventType.LedgerPosted,
      eventVersion: 99,
      producer: 'ledger-service',
      aggregateType: 'journal',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {},
    });

    try {
      ledgerFlowRegistry().parse(envelope);
      expect.unreachable('expected the version to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedEventVersionError);
      expect((error as UnsupportedEventVersionError).code).toBe('UNSUPPORTED_EVENT_VERSION');
      expect((error as UnsupportedEventVersionError).details).toMatchObject({
        eventVersion: 99,
        supported: [1],
      });
    }
  });
});
