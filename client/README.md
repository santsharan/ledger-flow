# LedgerFlow console

Operator console for the LedgerFlow services. It does not keep a second copy of financial state.

The browser never sees access or refresh tokens. Login stores them in HttpOnly cookies, and `/api/backend` attaches the access token when it calls a service.

## Run

```bash
pnpm install
pnpm dev
```

The console listens on port 3102. Service URLs default to the local ports in `.env.example`.

Sign in with an identity-service user. Buttons follow that user's permissions. The services still reject a call the UI should not have offered.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`e2e/shell.spec.ts` covers the unauthenticated shell. `e2e/workflows.spec.ts` talks to a running backend when `LEDGERFLOW_E2E=1` and `LEDGERFLOW_E2E_EMAIL`, `LEDGERFLOW_E2E_PASSWORD`, and `LEDGERFLOW_E2E_MERCHANT_ID` are set.

## Money movement

Amounts are integer minor units. Authorize, capture, refund, resolve, and ledger posting each require confirmation and send an `Idempotency-Key`. A failed or timed-out request is not retried by itself. An unknown provider status is resolved, not submitted again as a new authorization.
