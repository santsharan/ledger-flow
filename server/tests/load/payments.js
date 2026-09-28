import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// Baseline script. It does not tune anything. Record p50/p95/p99 from the summary.
const createTrend = new Trend('payment_create_duration', true);

export const options = {
  scenarios: {
    create: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3003';
const token = __ENV.ACCESS_TOKEN;

export default function () {
  const key = `load-${__VU}-${__ITER}-${Date.now()}`;
  const response = http.post(
    `${baseUrl}/api/v1/payments`,
    JSON.stringify({
      merchantId: __ENV.MERCHANT_ID,
      amountMinor: '10000',
      currency: 'INR',
    }),
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
      },
    },
  );

  createTrend.add(response.timings.duration);
  check(response, {
    'created or conflict': (result) => result.status === 201 || result.status === 409,
  });
  sleep(0.1);
}
