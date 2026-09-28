import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    balance: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3004';

export default function () {
  const response = http.get(`${baseUrl}/api/v1/accounts/${__ENV.ACCOUNT_ID}/balance`, {
    headers: { authorization: `Bearer ${__ENV.ACCESS_TOKEN}` },
  });
  check(response, { 'balance ok': (result) => result.status === 200 });
  sleep(0.05);
}
