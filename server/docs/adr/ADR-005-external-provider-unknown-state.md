# ADR-005: Explicit unknown states for external operations

Status: Accepted
Date: 2026-09-25

## Context

This is the defining distributed-systems problem in payments. We send `authorize` to the acquirer.
The acquirer processes it successfully. The response is lost — connection reset, timeout, pod
killed mid-flight. Our service now knows only that it sent a request; it does not know whether
money was reserved.

Two common reactions are both wrong:

1. **Treat it as a failure** — the customer is charged and our system says they were not.
2. **Retry immediately** — if the first call succeeded, the retry may create a second charge.

The honest answer is that the outcome is *unknown*, and unknown is a real state that the system
must be able to represent, persist, alert on and resolve.

## Decision

Introduce explicit unknown states: `AUTHORIZATION_UNKNOWN`, `CAPTURE_UNKNOWN`, `REFUND_UNKNOWN`,
`SETTLEMENT_UNKNOWN`.

When a provider call times out or fails ambiguously (no definitive response received), the attempt
is recorded as `UNKNOWN` and the aggregate moves to the corresponding unknown state. **No
automatic retry of the operation is performed.**

Resolution happens through a **status reconciler**: a scheduled worker queries the provider's
status endpoint using the attempt ID (which was sent as the provider-side idempotency key) and
drives the state machine to a definite outcome. If the provider is also unsure, the payment stays
unknown and ages into an operator alert.

Retries of the *original operation* are only safe because every provider call carries the attempt
ID as an idempotency key — but even then we prefer a status lookup, because it asks a question
instead of asserting an action.

## Alternatives considered

- **Blind retry with backoff.** Risks duplicate financial effects; the provider's idempotency is
  an assumption we refuse to depend on for correctness.
- **Optimistically mark as failed.** Creates customer-visible discrepancies and makes the ledger
  disagree with the provider — precisely what reconciliation would then have to detect anyway.
- **Optimistically mark as authorized.** Worse: may post ledger entries for money that was never
  reserved.
- **Block the request thread until certainty.** Holds connections and locks during an unbounded
  external wait. Rejected — see also ADR on transaction boundaries within ADR-006.

## Trade-offs

- More states, more transitions, more tests.
- Payments can sit in an unresolved state for a bounded period; this is surfaced as a metric
  (`payments_unknown_total`) and an alert rather than hidden.
- Requires the provider to expose a status lookup — the simulator provides one, and a real
  integration without one would need a compensating design (documented as an assumption).

## Consequences

- Duplicate financial effects from lost responses are structurally prevented.
- Reconciliation becomes the recovery mechanism for ambiguity, not just a daily accounting job.
- The system can demonstrate, deterministically, the "provider succeeded but the response was
  lost" scenario end to end (Killer Demo #2).
- The platform never claims certainty it does not have.
