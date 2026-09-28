# ADR-004: Explicit payment state machine

Status: Accepted
Date: 2026-09-25

## Context

Payment status is frequently modelled as a free-form string updated by whatever code path happens
to run. That allows illegal transitions (refunded → authorized), silent overwrites of failures by
late-arriving responses, and status values that no longer correspond to any real provider state.

## Decision

Payment status is an explicit finite state machine. Transitions are declared in one place as a
table of `from → allowed[to]`, and every transition is performed by a named domain operation
(`authorize`, `recordAuthorizationResult`, `capture`, `refund`, `cancel`, `resolveUnknown`) — never
by a generic status setter and never by a public `PATCH /payments/{id}`.

An illegal transition raises the typed error `INVALID_PAYMENT_STATE_TRANSITION`. The transition is
evaluated inside the same transaction that holds `SELECT ... FOR UPDATE` on the payment row, so
concurrent requests cannot both observe a stale state and both proceed.

Amount invariants are enforced alongside the transition: `captured ≤ authorized`,
`refunded ≤ captured`, same currency throughout.

## Alternatives considered

- **Free-form status strings.** Rejected: no guard against illegal transitions.
- **Workflow engine (Temporal, Camunda).** Powerful and genuinely suited to long-running payment
  workflows, but it would own the orchestration this project exists to demonstrate explicitly, and
  it adds an operational dependency. Documented as a legitimate future option.
- **Status derived purely from the attempt history.** Elegant, but derivation under concurrency
  would need the same locking anyway, and it makes indexing/querying by status harder.

## Trade-offs

- Adding a state requires editing the transition table and its tests — deliberate friction.
- Some legitimate operational corrections need an explicit, audited administrative transition
  rather than an ad-hoc update.
- Partial capture is supported once, releasing the residual authorization; multiple partial
  captures are out of scope and documented as a limitation.

## Consequences

- Illegal transitions are impossible to reach through normal code paths and are unit-testable
  exhaustively (every `from × to` pair).
- Late or duplicate provider responses cannot overwrite a terminal state.
- The state machine table doubles as documentation and as the diagram source in
  `docs/architecture/payment-lifecycle.md`.
