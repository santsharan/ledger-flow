# Frontend production readiness

This is a review of `client/ledgerflow-console` against the LedgerFlow services as they exist. It is not a claim that the console is production ready.

## PASS

- The console is a Next.js App Router application. Server state goes through TanStack Query. Jotai holds sidebar, payment filters, the selected payment and case, toasts, and the confirmation dialog.
- Login stores access and refresh tokens in HttpOnly cookies. The login response returned to the browser is the user profile. Route handlers attach the access token when they call a service.
- Navigation and action buttons check permission strings. A missing permission hides the control and the page explains the denial. The services still enforce the same permissions.
- Amounts are integer minor-unit strings. Display formatting does not parse them as floats.
- Authorize, capture, refund, resolve, ledger posting, journal reversal, and settlement transitions require an explicit confirmation. Money commands send an idempotency key and are not retried by the client.
- `AUTHORIZATION_UNKNOWN`, `CAPTURE_UNKNOWN`, and `REFUND_UNKNOWN` offer resolve, not a second authorization.
- Posted journal lines are shown as read-only. Reversal is a new journal and is available only with `ledger.post`.
- Reconciliation offers only the transitions the case state machine allows. An open case cannot jump to resolved.
- Lists, empty states, errors, and limit/offset pagination are present. Status badges include the status text.
- Lint, typecheck, unit tests, and the production build pass. The unauthenticated Playwright checks pass: unknown routes redirect to login, and a short password is rejected in the form.

## PARTIAL

- Dashboard counts are computed from the latest page each service returns. There is no aggregate metrics API, so the screen says so.
- Payment audit is the payment service's `audit_events` table. Ledger, settlement, and identity audits are not combined into one timeline.
- The payment service does not deploy a `dead_letters` table. The operations screen says that and shows the outbox, including failed publications. There is no replay call, so `admin.replay` has no button.
- Risk decisions can be evaluated and are then immutable. `risk.override` has no HTTP endpoint, so the console does not pretend to override one.
- Users can be created and loaded by id. There is no list-users endpoint.
- `ledger.post` is not granted to human roles. Journal posting and reversal stay hidden unless a principal actually has that permission. Payment capture still links to the journal the payment service posted.
- The date filter on payments filters the page already loaded. The list API filters by status, limit, and offset.
- The money-movement Playwright file is written for a live backend and is skipped unless `LEDGERFLOW_E2E=1`. It was not executed against the services in this review.

## FAIL

- The console was not exercised through a live authorize, capture, refund, settlement, and reconciliation run in a browser with the services up. The shell tests do not cover those mutations.
- Accessibility was checked structurally (labels, dialog semantics, status text, skip link). It was not audited with a screen reader.
- The production image was not built or run.

## RISK

- A cookie proves a browser session to the middleware. The console layout still asks identity `/auth/me` before rendering. If that check is removed later, a stolen cookie shape would be treated as a principal.
- Refresh-token rotation happens inside the proxy after a 401. A concurrent pair of requests can rotate the refresh token twice and invalidate one of them.
- Search probes several services with the same id. A 403 is shown as a possible hit, which tells the operator a record may exist without revealing it. That is a small existence signal.
- Dashboard and list pages can show a partial page as if it were the operational picture. The labels say it is a page. An operator can still misread it during an incident.

## RECOMMENDATION

Run the console against the local stack and complete one payment through authorize, capture, journal inspection, settlement, and a reconciliation mismatch before treating the UI as a demo. Add a ledger consumer so capture's journal is not left pending, then point the payment detail at that journal. Do not add a browser replay button until replay is an audited service operation with its own idempotency key.
