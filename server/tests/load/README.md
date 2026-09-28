# Load tests

k6 scripts for a short baseline. They are not a capacity plan.

| Script | What it hits |
| --- | --- |
| `payments.js` | `POST /api/v1/payments` |
| `ledger-read.js` | `GET /api/v1/accounts/{id}/balance` |

```bash
k6 run -e BASE_URL=http://127.0.0.1:3003 -e ACCESS_TOKEN=... -e MERCHANT_ID=... tests/load/payments.js
k6 run -e BASE_URL=http://127.0.0.1:3004 -e ACCESS_TOKEN=... -e ACCOUNT_ID=... tests/load/ledger-read.js
```

Read `http_req_duration` p50, p95, and p99 from the k6 summary. Do not change pool sizes or indexes from a single 30-second run.

No baseline numbers are checked in. A run was not executed in this environment because k6 was not invoked against a booted stack. See `PRODUCTION_READINESS.md`.
