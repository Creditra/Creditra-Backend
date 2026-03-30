import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Spike test configuration - sudden traffic surge
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Warm up
    { duration: '10s', target: 200 },  // Sudden spike to 200 users
    { duration: '1m', target: 200 },   // Hold spike
    { duration: '10s', target: 10 },   // Drop back down
    { duration: '30s', target: 0 },    // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests must complete below 2s
    http_req_failed: ['rate<0.15'],    // Error rate must be below 15%
    errors: ['rate<0.15'],             // Custom error rate below 15%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Focus on most common endpoints during spike
  const scenario = Math.random();

  if (scenario < 0.7) {
    // Health check - most common
    let healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, {
      'health status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  } else {
    // List credit lines
    let listRes = http.get(`${BASE_URL}/api/credit/lines?offset=0&limit=10`);
    check(listRes, {
      'list status is 200': (r) => r.status === 200,
    }) || errorRate.add(1);
  }

  sleep(0.1); // Minimal sleep during spike
}
