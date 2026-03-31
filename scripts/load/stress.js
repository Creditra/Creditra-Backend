import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Stress test configuration - higher load
export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up to 50 users over 1 minute
    { duration: '3m', target: 50 },   // Stay at 50 users for 3 minutes
    { duration: '1m', target: 100 },  // Spike to 100 users
    { duration: '2m', target: 100 },  // Stay at 100 users for 2 minutes
    { duration: '1m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% of requests must complete below 1s
    http_req_failed: ['rate<0.10'],    // Error rate must be below 10%
    errors: ['rate<0.10'],             // Custom error rate below 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Weighted scenario: 60% reads, 30% risk eval, 10% specific lookups
  const scenario = Math.random();

  if (scenario < 0.6) {
    // Read operations
    let listRes = http.get(`${BASE_URL}/api/credit/lines?offset=0&limit=20`);
    check(listRes, {
      'list status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  } else if (scenario < 0.9) {
    // Risk evaluation
    const riskPayload = JSON.stringify({
      walletAddress: `GABC${Math.floor(Math.random() * 1000000)}DEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDE`,
    });

    const riskParams = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    let riskRes = http.post(`${BASE_URL}/api/risk/evaluate`, riskPayload, riskParams);
    check(riskRes, {
      'risk evaluate status is 200 or 400': (r) => r.status === 200 || r.status === 400,
    }) || errorRate.add(1);
  } else {
    // Specific credit line lookup (will 404 but tests the path)
    let getRes = http.get(`${BASE_URL}/api/credit/lines/test-${Math.floor(Math.random() * 100)}`);
    check(getRes, {
      'get credit line status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    }) || errorRate.add(1);
  }

  sleep(Math.random() * 2); // Random sleep between 0-2 seconds
}
