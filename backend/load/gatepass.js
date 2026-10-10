import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PASSWORD = 'supersecret';
const RUN = Date.now().toString(36);

export const options = {
  scenarios: {
    // Logged-in users: log in, then hit /me a few times. Each VU has its own cookie jar.
    users: {
      executor: 'ramping-vus',
      exec: 'userJourney',
      stages: [
        { duration: '20s', target: 50 },
        { duration: '40s', target: 150 },
        { duration: '20s', target: 0 },
      ],
    },
    // Fixed request rate regardless of how slow the API gets: the shape real traffic has.
    jobs: {
      executor: 'ramping-arrival-rate',
      exec: 'queueJob',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '40s', target: 200 },
        { duration: '20s', target: 0 },
      ],
    },
    // Clients that misbehave: broken JSON, double-clicked sign-up buttons.
    sloppy_clients: {
      executor: 'constant-arrival-rate',
      exec: 'sloppyClient',
      rate: 2,
      timeUnit: '1s',
      duration: '80s',
      preAllocatedVUs: 10,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:users}': ['p(95)<500'],
    'http_req_duration{scenario:jobs}': ['p(95)<200'],
    checks: ['rate>0.99'],
  },
};

export function userJourney() {
  const email = `k6-${RUN}-${exec.vu.idInTest}@load.test`;
  const body = JSON.stringify({ email, password: PASSWORD });

  if (exec.vu.iterationInScenario === 0) {
    const res = http.post(`${BASE}/api/auth/register`, body, { headers: JSON_HEADERS });
    check(res, { 'register 201': (r) => r.status === 201 });
  } else {
    const res = http.post(`${BASE}/api/auth/login`, body, { headers: JSON_HEADERS });
    check(res, { 'login 200': (r) => r.status === 200 });
  }

  for (let i = 0; i < 5; i++) {
    const me = http.get(`${BASE}/api/auth/me`);
    check(me, { 'me 200': (r) => r.status === 200 });
    sleep(0.2);
  }
  sleep(1);
}

export function queueJob() {
  const res = http.post(
    `${BASE}/api/jobs`,
    JSON.stringify({ n: exec.scenario.iterationInTest, fail: Math.random() < 0.05 }),
    { headers: JSON_HEADERS },
  );
  check(res, { 'job 202': (r) => r.status === 202 });
}

export function sloppyClient() {
  // A client bug: truncated JSON. A correct API answers 400, not 500.
  const bad = http.post(`${BASE}/api/jobs`, '{"broken":', {
    headers: JSON_HEADERS,
    responseCallback: http.expectedStatuses(400),
  });
  check(bad, { 'malformed json -> 400': (r) => r.status === 400 });

  // Double-clicked sign-up: two identical requests at the same moment. Expect one 201 and one 409.
  const email = `dup-${RUN}-${exec.scenario.iterationInTest}@load.test`;
  const req = {
    method: 'POST',
    url: `${BASE}/api/auth/register`,
    body: JSON.stringify({ email, password: PASSWORD }),
    params: { headers: JSON_HEADERS, responseCallback: http.expectedStatuses(201, 409) },
  };
  const [a, b] = http.batch([req, req]);
  check([a.status, b.status].sort().join(','), { 'double sign-up -> 201,409': (s) => s === '201,409' });
}
