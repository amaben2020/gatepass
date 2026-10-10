# Gatepass

A backend for high-demand ticket sales, built to handle the moment a concert goes on sale and thousands of people arrive at once. It's a learning project for the patterns behind that: session auth, queues and workers, retries and dead-letter queues, and full observability with Prometheus, Loki and Grafana, all running locally and headed for AWS EKS.

**Built so far:**
- **Auth:** register, log in, log out; sessions stored in Postgres.
- **Virtual waiting room:** users join a line held in Redis. A gatekeeper lets them out in batches with a time-limited pass, and hands their order to a worker through SQS.
- **Observability:** structured logs, metrics, a Grafana dashboard, and k6 load tests.

## Waiting room: how it works

```
 user picks a seat
        │
        ▼
 POST /api/jobs/waiting-room ──► Redis sorted set (score = join time)
        │                         ZADD NX: clicking again keeps your place
        │                         returns your position in line
        ▼
 ┌───────────────── gatekeeper (every 2s) ─────────────────┐
 │ ZPOPMIN 100 users  (atomic: two gatekeepers never       │
 │                     admit the same user)                │
 │ SET vip-accept-pay-<userId> EX 600   (10-minute pass)   │
 │ SendMessage → SQS gatepass-jobs      (order job)        │
 │ on failure: put the user back at their original place   │
 └──────────────────────────┬──────────────────────────────┘
                            ▼
 ┌───────────────── SQS worker (long polling) ─────────────┐
 │ process the order → DeleteMessage                        │
 │ failure → no delete → SQS redelivers (visibility 10s)    │
 │ 3 failed attempts → gatepass-jobs-dlq                    │
 └──────────────────────────────────────────────────────────┘
```

**Why the queue lives in Redis and not SQS:** a user needs their position the moment they join, and SQS can't tell you "you're 4,312th in line". A Redis sorted set answers that with `ZRANK` in under a millisecond. SQS is used where it fits: slow, retryable work that must not be lost.

## Stack

| Area | Tools |
|---|---|
| API | Node 24, TypeScript, Express 5 |
| Auth | `express-session`, sessions stored in Postgres (`connect-pg-simple`), scrypt password hashing |
| Database | PostgreSQL + Drizzle ORM (migrations in `backend/drizzle/`) |
| Waiting room | Redis sorted set (`node-redis`) |
| Jobs | AWS SQS via LocalStack, with a dead-letter queue |
| Process manager | pm2 (gatekeeper + SQS worker) |
| Observability | Winston → Loki, prom-client → Prometheus, Grafana dashboard, cAdvisor for container CPU and memory |
| Load testing | k6 |

## Quick start

### Prerequisites

- Node 24+
- Docker
- [pm2](https://pm2.keymetrics.io/) (`npm i -g pm2`) and [k6](https://k6.io/) (`brew install k6`)
- A LocalStack auth token from [app.localstack.cloud](https://app.localstack.cloud) (free tier is fine)

### 1. Postgres and Redis

```bash
docker run -d --name my-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker exec my-postgres psql -U postgres -c 'CREATE DATABASE gatepass'
```

### 2. Configure

```bash
cd backend
npm install --include=dev
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL`, for example `postgresql://postgres:postgres@localhost:5432/gatepass`
- `SESSION_SECRET`, generated with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `LOCALSTACK_AUTH_TOKEN`

The rest of the defaults work as they are.

### 3. Run

```bash
npm run infra:up        # LocalStack (creates the queues), Loki, Prometheus, Grafana, cAdvisor
npm run db:migrate      # users + session tables
npm run dev             # API on http://localhost:4000 (reloads on save)
npm run workers:start   # gatekeeper + SQS worker in the background
npm run workers:logs    # watch them
```

### 4. Try it

```bash
# register (saves the session cookie)
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"me@test.dev","password":"supersecret"}' localhost:4000/api/auth/register

# join the waiting room
curl -b cookies.txt -X POST localhost:4000/api/jobs/waiting-room
# → {"userId":"…","position":1}
```

Within 2 seconds the logs show the user being admitted and their order processed:

```
INFO  api         joined waiting room  position=1
INFO  gatekeeper  user admitted        orderMessageId=503670f7…
INFO  worker      processing job       attempt=1
INFO  worker      job done             durationMs=5
```

Join again and you get `409 Already admitted` until the pass expires.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | Create an account and log in. `409` if the email is taken. |
| `POST` | `/api/auth/login` | none | Log in. `401` on a wrong email or password. |
| `POST` | `/api/auth/logout` | session | Destroy the session. |
| `GET` | `/api/auth/me` | session | The current user. |
| `POST` | `/api/jobs/waiting-room` | session | Join the line; returns `position`. `409` if already admitted. |
| `POST` | `/api/jobs` | none | Send any JSON body to SQS. Include `"fail": true` to watch it retry and land in the DLQ. |
| `GET` | `/metrics` | none | Prometheus metrics. |

Sessions use an HTTP-only cookie (`gatepass.sid`). The cookie holds only a signed ID; the session data lives in Postgres.

## Observability

| URL | What |
|---|---|
| http://localhost:3000/d/gatepass | Grafana dashboard (no login locally) |
| http://localhost:9090 | Prometheus |
| http://localhost:4000/metrics | Raw API metrics |

The dashboard covers:
- **API:** requests per second, latency p50/p95/p99, 5xx error ratio.
- **Jobs and SQS:** jobs sent compared with processed, queue depth (waiting, in flight, DLQ).
- **Waiting room and workers:** line size, admission rate, a worker activity log.
- **Resources:** CPU, memory, heap and event-loop lag per process, plus CPU and memory per container.
- **Logs:** searchable logs from every service. Paste a `userId` or `messageId` into the **trace** box to follow it across the API, gatekeeper and worker.

[`backend/LOGGER-README.md`](backend/LOGGER-README.md) is a guide to reading all of this: PromQL and LogQL from basic examples, a triage workflow, and a case study of four bugs found under load and how they were fixed.

## Load testing

```bash
npm run load
```

[`backend/load/gatepass.js`](backend/load/gatepass.js) runs about 80 seconds of mixed traffic at around 320 requests/s:
- logged-in users calling `/me`,
- a flood of jobs, 5% of them set to fail,
- badly behaved clients sending broken JSON and two identical sign-ups at once.

Its thresholds fail the run if more than 1% of requests error or latency goes over budget. The rate limiter is off outside production so k6 can run from one IP.

## Project structure

```
backend/
├── src/
│   ├── app.ts                    Express app: middleware, routes, error handler
│   ├── server.ts                 HTTP entry point
│   ├── worker.ts                 SQS worker
│   ├── config/                   db (Drizzle + pg), redis, sqs, logger, metrics
│   ├── features/
│   │   ├── auth/                 model / repository / service / controller / routes
│   │   └── jobs/
│   │       ├── jobs.routes.ts    waiting room + job endpoints
│   │       └── worker/process.ts gatekeeper
│   └── middleware/               request logging + metrics, requireAuth
├── drizzle/                      SQL migrations
├── localstack/init.sh            creates gatepass-jobs + gatepass-jobs-dlq on startup
├── monitoring/                   Prometheus config, Grafana provisioning + dashboard
├── load/gatepass.js              k6 scenarios
├── docker-compose.yml            LocalStack, Loki, Prometheus, Grafana, cAdvisor
└── ecosystem.config.cjs          pm2 apps
```

## Scripts

Run these from `backend/`.

| Script | Does |
|---|---|
| `npm run dev` | API with hot reload |
| `npm run infra:up` / `infra:down` | Start or stop the Docker services |
| `npm run workers:start` / `restart` / `stop` / `logs` | Manage the gatekeeper and SQS worker with pm2 |
| `npm run db:update` | Generate and apply a migration after a schema change |
| `npm run db:studio` | Browse the database |
| `npm run load` | k6 load test |
| `npm run typecheck` | TypeScript check |

## Known limitations

- **For testing, `POST /api/jobs/waiting-room` accepts a `userId` in the request body** in place of the session user. That lets any client queue as anyone. Remove it before real use.
- **The SQS worker's `handle()` is a placeholder.** It simulates processing an order; there's no payment or ticket issuance yet.
- **The gatekeeper admits a fixed 100 users every 2 seconds** rather than adapting to free checkout capacity.
- **LocalStack doesn't keep data between restarts.** The queues are recreated on startup, but any messages are lost.
- **Container metrics show IDs instead of names** on Docker Desktop with the containerd image store.
