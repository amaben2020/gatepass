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
 POST /api/events/:id/waiting-room ──► waiting:{id}  sorted set, score = join time
        │                         ZADD NX: joining again keeps your place
        ▼
 ┌───────────────── gatekeeper (every 2s, per on-sale event) ─────────────┐
 │ one Lua script, atomic:                                                  │
 │   drop expired shoppers → free = MAX_SHOPPERS − shopping                 │
 │   ZPOPMIN free users → SET pass:{id}:<user> EX 900 → ZADD shoppers:{id}  │
 └──────────────────────────┬───────────────────────────────────────────────┘
                            ▼
 GET  /api/events/:id/waiting-room   → waiting (position) | admitted | not_in_line
 GET  /api/events/:id/seats          → map: available | held | yours | sold   (needs a pass)
 POST /api/events/:id/seats/hold     → Lua: all-or-nothing SET seat:{id}:<seat> EX 600
        ▼
 POST /api/events/:id/orders         → order (pending) + Stripe PaymentIntent → clientSecret
        │   the app collects the card with Stripe's Payment Element (card details never touch our server)
        ▼
 Stripe → POST /api/payments/webhook → verify signature → dedupe (webhook_events) → SQS FIFO
        │                              MessageGroupId = orderId, MessageDeduplicationId = Stripe event id
        ▼
 ┌──────────── issue-ticket worker ─────────────────────────────────────────┐
 │ order already finished? → skip (idempotent)                               │
 │ payment failed → order failed, release seats                              │
 │ seat locks expired → refund (Stripe idempotency key)                      │
 │ else ONE transaction: seats → sold, insert tickets, order → paid          │
 │ after COMMIT: release locks, free the shopping slot, send email           │
 └───────────────────────────────────────────────────────────────────────────┘
 ┌──────────── issue-ticket worker (SQS long poll) ────────┐
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
npm run workers:start   # gatekeeper + issue-ticket worker in the background
npm run doctor          # check everything is up
npm run workers:logs    # watch them
```

### 4. Try it

```bash
# register (saves the session cookie)
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"me@test.dev","password":"supersecret"}' localhost:4000/api/auth/register

# seed an on-sale event with 200 seats and a test user (ada@gatepass.dev / supersecret)
npm run db:seed

# join the waiting room, then poll until admitted (the gatekeeper ticks every 2s)
curl -b cookies.txt -X POST localhost:4000/api/events/<eventId>/waiting-room
# → {"status":"waiting","position":1}
curl -b cookies.txt localhost:4000/api/events/<eventId>/waiting-room
# → {"status":"admitted","expiresAt":"…"}

# seat map, then hold seats
curl -b cookies.txt localhost:4000/api/events/<eventId>/seats
curl -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"seatIds":["<seatId>","<seatId>"]}' localhost:4000/api/events/<eventId>/seats/hold
# → {"seats":[…],"total":4000000,"expiresAt":"…"}
```

## Payments (Stripe test mode)

1. In the Stripe dashboard, switch on **Test mode** and copy the test keys from Developers → API keys:
   - `backend/.env` → `STRIPE_SECRET_KEY=sk_test_…`
   - `frontend/.env` → `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…`
2. Forward Stripe's webhooks to your laptop (Stripe can't reach `localhost` by itself):
   ```bash
   stripe login
   stripe listen --forward-to localhost:4000/api/payments/webhook
   ```
   It prints `whsec_…`: put it in `backend/.env` as `STRIPE_WEBHOOK_SECRET`, then restart `npm run dev` and `npm run workers:restart`.
3. Pay with `4242 4242 4242 4242` (any future date, any CVC). `4000 0000 0000 0002` is declined.

Never use `sk_live_` keys here: they charge real cards.

## Frontend

A React app (Vite + TypeScript) in `frontend/` that walks the buyer flow on a phone-sized screen: sign in → events → waiting room → your turn → seat map → seats held. Beside it, an **Under the hood** panel shows every API request and response (status, error `code`, timing) and the live Redis state behind the screen: line size, shoppers, your pass TTL and your seat locks.

```bash
cd frontend
npm install --include=dev
npm run dev             # http://localhost:5173, with /api proxied to :4000
```

Vite proxies `/api` to the backend, so the session cookie is same-origin: no CORS setup. The Redis panel reads `GET /api/debug/events/:id`, which only exists outside production. To see two buyers compete for seats, register a second user in a private window.


| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | Create an account and log in. `409` if the email is taken. |
| `POST` | `/api/auth/login` | none | Log in. `401` on a wrong email or password. |
| `POST` | `/api/auth/logout` | session | Destroy the session. |
| `GET` | `/api/auth/me` | session | The current user. |
| `POST` | `/api/events/:eventId/waiting-room` | session | Join the line. Idempotent; returns the current status. `409 NOT_ON_SALE` for events not on sale. |
| `GET` | `/api/events/:eventId/waiting-room` | session | Poll: `waiting` + position, `admitted` + `expiresAt`, or `not_in_line`. |
| `GET` | `/api/events/:eventId/seats` | session + pass | Seat map with `available` / `held` / `yours` / `sold`. `403 NO_PASS` without a pass. |
| `POST` | `/api/events/:eventId/seats/hold` | session + pass | Hold up to 4 seats for 10 minutes, replacing any previous hold. All or nothing: `409 SEAT_TAKEN` changes nothing. |
| `DELETE` | `/api/events/:eventId/seats/hold` | session | Release your held seats. |
| `POST` | `/api/events/:eventId/orders` | session + pass | Turn your held seats into a pending order and a Stripe PaymentIntent; returns `clientSecret`. A repeat with the same seats returns the same order. `409 HOLD_EXPIRED` / `NO_HOLD`. |
| `GET` | `/api/orders/:orderId` | session | Order status (`pending` → `paid` / `failed` / `refunded`) and, once paid, its tickets. |
| `POST` | `/api/payments/webhook` | Stripe signature | Stripe calls this. `400 BAD_SIGNATURE` for anything not signed with `STRIPE_WEBHOOK_SECRET`. |
| `POST` | `/api/jobs` | none | Send any JSON body to SQS. Include `"fail": true` to watch it retry and land in the DLQ. |
| `GET` | `/api/events` | none | List events with their status. |
| `GET` | `/api/debug/events/:eventId` | session | **Development only.** The Redis state for this event and user (used by the frontend's panel). |
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
│   ├── config/                   db (Drizzle + pg), redis, sqs, logger, metrics
│   ├── features/
│   │   ├── auth/                 model / repository / service / controller / routes
│   │   └── jobs/
│   │       ├── jobs.routes.ts    waiting room + job endpoints
│   │       └── worker/
│   │           ├── gatekeeper.ts     admits users from the waiting room
│   │           └── issue-ticket.ts   SQS worker: issues tickets
│   └── middleware/               request logging + metrics, requireAuth
├── drizzle/                      SQL migrations
├── localstack/init.sh            creates gatepass-jobs + gatepass-jobs-dlq on startup
├── monitoring/                   Prometheus config, Grafana provisioning + dashboard
├── load/gatepass.js              k6 scenarios
├── scripts/doctor.mjs            `npm run doctor` health check
├── docker-compose.yml            LocalStack, Loki, Prometheus, Grafana, cAdvisor
└── ecosystem.config.cjs          pm2 apps
```

## Scripts

Run these from `backend/`.

| Script | Does |
|---|---|
| `npm run dev` | API with hot reload |
| `npm run infra:up` / `infra:down` | Start or stop the Docker services |
| `npm run workers:start` | Start (or restart) the gatekeeper and issue-ticket workers with pm2. They restart on code changes. |
| `npm run workers:status` / `logs` / `stop` | Status table, live logs, stop and remove |
| `npm run doctor` | Check containers, workers, endpoints and firing alerts; prints the fix for anything down |
| `npm run db:update` | Generate and apply a migration after a schema change |
| `npm run db:studio` | Browse the database |
| `npm run load` | k6 load test |
| `npm run typecheck` | TypeScript check |

## Known limitations

- **The issue-ticket worker also consumes the demo `gatepass-jobs` queue** (`POST /api/jobs`), kept as an SQS playground.
- **The ticket email is simulated** (a log line). A real one would be enqueued after the transaction commits.
- **LocalStack doesn't keep data between restarts.** The queues are recreated on startup, but any messages are lost.
- **Container metrics show IDs instead of names** on Docker Desktop with the containerd image store.
