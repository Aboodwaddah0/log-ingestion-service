import http from 'k6/http';
import { check } from 'k6';

const URL = 'http://localhost:8080/logs';

function generateLogs(count) {
  const logs = [];

  for (let i = 0; i < count; i++) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'api',
      message: `Load test log ${i}`,
      attributes: {
        environment: 'test',
        requestId: `req-${i}`,
      },
    });
  }

  return logs;
}

const payload = JSON.stringify({
  logs: generateLogs(1000),
});

export const options = {
  scenarios: {
    ingestion: {
      executor: 'constant-arrival-rate',

      // 15 requests/sec
      rate: 15,
      timeUnit: '1s',

      // Test duration
      duration: '30s',

      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
};

export default function () {
  const response = http.post(URL, payload, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  check(response, {
    'status is 200': (r) => r.status === 200,
  });
}
