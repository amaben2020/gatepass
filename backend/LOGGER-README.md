# Reading logs and metrics in Gatepass

How to use Grafana, Prometheus and Loki to find out what the app is doing, spot problems, and confirm fixes. Every example works against this repo.

## The stack in one picture

```
 API (:4000/metrics)  ──┐                ┌── Prometheus (:9090)  numbers over time
 worker (:9101)       ──┼── scraped ───► │
 cAdvisor (:8080)     ──┘   every 5s     │
                                         ├── Grafana (:3000)  dashboards + Explore
 API + worker logs  ──── pushed ───────► └── Loki (:3100)     searchable log lines
```

| You want to know... | Use | Example |
|---|---|---|
| Is something wrong right now? How bad? | **Metrics** (Prometheus) | "5% of requests are failing" |
| What exactly went wrong for one request? | **Logs** (Loki) | "insert failed: duplicate key on users_email_unique" |

Metrics tell you **that** something is wrong and **where**. Logs tell you **why**. Always start with metrics and finish with logs.

Start everything with `npm run infra:up`, `npm run dev` and `npm run workers:start`, then open http://localhost:3000/d/gatepass.

---

## 1. Read the dashboard first

**Set the time range to match what you're investigating.** An 80-second load test on a "Last 15 minutes" graph is a thin spike at the right edge and looks like nothing happened. Use **Last 5 minutes**, or drag across the spike to zoom in.

The top row covers the three signals every service is judged on, known as **RED**: Rate, Errors, Duration.

| Panel | Healthy | Worry when |
|---|---|---|
| Requests / sec | Follows your traffic | Drops suddenly (clients can't reach you) or a single route explodes |
| Latency p50/p95/p99 | Flat while traffic rises | p95 climbs as traffic rises: you're near capacity |
| Error ratio (5xx) | 0, or a line that never shows up | Anything above 0 for more than a moment |
| Queue depth: `waiting` | Near 0 | Keeps growing: the worker can't keep up |
| Queue depth: DLQ `waiting` | 0 | Any increase: messages are failing permanently |
| Event loop lag p99 | A few ms | Over 100ms: something is blocking Node |
| Process health (top row) | All UP | Any DOWN: that process is stopped, crashed or hung. Run `npm run doctor` |
| CPU | Below 1.0 per process when idle | Pinned at about 1.0: Node's single thread is saturated |

**Percentiles, not averages.** p95 = 200ms means 95% of requests finished within 200ms and 5% were slower. An average hides those slow 5%, and they're the requests your users complain about.

---

## 2. PromQL: querying metrics

Go to **Grafana → Explore → Prometheus**, or use http://localhost:9090.

### The three metric types

| Type | Behaviour | In Gatepass | Use it with |
|---|---|---|---|
| **Counter** | Only goes up (resets on restart) | `jobs_sent_total`, `http_request_duration_seconds_count` | `rate()` or `increase()`, never on its own |
| **Gauge** | Goes up and down | `sqs_queue_messages`, `process_resident_memory_bytes` | Use as-is, or `max_over_time()` |
| **Histogram** | Request counts in latency buckets | `http_request_duration_seconds_bucket` | `histogram_quantile()` |

### Basic queries, simplest first

```promql
# Raw counter. Not useful on its own; it just grows.
jobs_sent_total

# Per-second rate over the last minute. This is what you graph.
rate(jobs_sent_total[1m])

# Requests/sec split by route and status
sum by (route, status_code) (rate(http_request_duration_seconds_count[1m]))

# Total requests in the last 5 minutes (increase = rate × window)
sum by (route, status_code) (increase(http_request_duration_seconds_count[5m]))

# Only the failures
sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[1m]))

# Share of requests that are 5xx (0.02 = 2%)
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[1m]))
  / sum(rate(http_request_duration_seconds_count[1m]))

# p95 latency per route
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[1m])))

# Worst moment in the last 10 minutes
max_over_time(nodejs_eventloop_lag_p99_seconds[10m])
max_over_time(sqs_queue_messages{queue="gatepass-jobs", state="waiting"}[10m])

# Rank: the 3 busiest routes
topk(3, sum by (route) (rate(http_request_duration_seconds_count[5m])))
```

### Common mistakes

- **`rate()` on a gauge.** `rate(sqs_queue_messages[1m])` is meaningless. Rate is only for counters.
- **`sum` before `rate`.** Write `sum(rate(x[1m]))`, never `rate(sum(x)[1m])`. Counters reset on restart, and `rate` knows how to handle that only if it sees the raw series.
- **Dropping `le` from a histogram.** `histogram_quantile` needs the `le` (bucket) label: `sum by (le, route)`, not `sum by (route)`.
- **High-cardinality labels.** Never put user IDs, emails or raw URLs in a label. Every unique value creates a new time series. That's why the middleware records `route="/api/users/:id"` rather than the real path.

---

## 3. LogQL: searching logs

Go to **Grafana → Explore → Loki**, or use the Logs panel at the bottom of the dashboard.

Every log line is JSON with these fields: `level`, `message`, `service`, `timestamp`, plus extras such as `route`, `status`, `durationMs`, `messageId`, `error`, `stack`.

A LogQL query reads left to right: **pick streams → filter lines → parse → filter fields → (optional) count**.

```logql
# 1. Pick streams by label (always required)
{app="gatepass"}
{app="gatepass", service="issue-ticket"}
{app="gatepass", level="error"}

# 2. Line filter: plain text search. Fast; do this early.
{app="gatepass"} |= "duplicate key"
{app="gatepass"} != "/metrics"

# 3. Parse JSON, then filter on fields
{app="gatepass", service="api"} | json | status >= 500
{app="gatepass", service="api"} | json | route="/api/auth/login" and durationMs > 200
{app="gatepass", service="issue-ticket"} | json | message="job failed" and attempt >= 3

# 4. Follow one message through its whole life
{app="gatepass"} |= "8ab1e150-31d2-4bbd-85ac-9e2e867072c0"

# 5. Show only the fields you care about
{app="gatepass", level="error"} | json | line_format "{{.route}} {{.status}} {{.error}}"
```

### Turning logs into numbers

Logs can be counted like metrics. This is how you find the *most common* error rather than the most recent one.

```logql
# Log lines per level per minute
sum by (level) (count_over_time({app="gatepass"} [1m]))

# Error lines grouped by what they say: your to-do list, biggest first
sum by (error) (count_over_time({app="gatepass", level="error"} | json [15m]))

# Non-2xx responses grouped by route and status
sum by (route, status) (count_over_time({app="gatepass", service="api"} | json | status >= 400 [15m]))

# The 5 slowest routes, by the longest request seen
topk(5, max by (route) (max_over_time({service="api"} | json | message="request" | unwrap durationMs [5m])))
```

---

## 4. Triage: what a lead engineer does

When something looks off, go in this order and don't skip ahead to the code.

1. **Is it real, and is it still happening?** Check the error ratio and latency panels. A single blip is noise; a plateau is an incident.
2. **How big is it?** Check what share of requests are affected and which routes. A 0.1% error rate on login is different from 40% on everything.
3. **Where is it?** Group by `route` and `status_code` (PromQL) to narrow it to one endpoint.
4. **Why?** Go to Loki: `{app="gatepass", level="error"} | json | route="<that route>"`. Read the `error` and `stack` fields. Group by `error` to see whether it's one bug or several.
5. **Classify each one:**
   - **4xx:** the client sent something wrong. Fine, as long as it's the *right* 4xx.
   - **5xx caused by bad client input:** a bug in your code. You should have returned 4xx.
   - **5xx from a dependency** (database, SQS): check that dependency's health and your timeouts and connection pools.
   - **Slow but successful:** check CPU and event loop lag. Is something blocking, or is the machine saturated?
6. **Fix the smallest correct thing.**
7. **Prove it.** Re-run the same load test and compare the same queries before and after.

---

## 5. Case study: the first load test

`npm run load` runs `load/gatepass.js` with k6: logged-in users, a flood of jobs (5% set to fail), and some badly behaved clients. Here's what the first run showed and how each issue was found and fixed.

**k6 summary, run 1:** about 320 requests/s, p95 = 44ms, but `http_req_failed` was 1.24% and two checks failed every time.

### Issue 1: malformed JSON returned 500 instead of 400

**Found with:**
```logql
{app="gatepass", level="error"} | json | message="unhandled error"
```
```
path:  /api/jobs
error: Unexpected end of JSON input
stack: SyntaxError ... at body-parser/lib/types/json.js
```

**Diagnosis:** `express.json()` throws when the body isn't valid JSON. The error handler treated every unknown error as a 500, which means the server is blamed for a client mistake. It also pollutes the error ratio and would page someone at 3am for nothing.

**Fix** (`src/app.ts`): body-parser errors carry `status` and `expose`, so pass them through.
```ts
if (err.expose && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
```

### Issue 2: two simultaneous sign-ups returned 201 + 500 instead of 201 + 409

**Found with:**
```promql
sum by (route, status_code) (increase(http_request_duration_seconds_count{status_code=~"5.."}[5m]))
```
That showed 163 errors on the register route. Then, in Loki:
```
error: Failed query: insert into "users" ...
```

**Diagnosis:** a race condition. Both requests ran `findByEmail` and both found nothing, then both inserted. Postgres's `UNIQUE` constraint correctly rejected the second insert (error code `23505`), but the code didn't expect it. Checking first and then inserting is never safe under concurrency; the database constraint is the real guard.

**Fix** (`src/features/auth/auth.service.ts`): catch the constraint violation and return 409.
```ts
catch (err) {
  if (isUniqueViolation(err)) throw new AuthError('Email already registered', 409);
  throw err;
}
```

### Issue 3: password hashes leaked into the logs

**Found while reading issue 2's log line.** Drizzle's error message ends with `params: dup-...@load.test,ca6a5760...`, which includes the user's email and password hash, now stored in Loki.

**Diagnosis:** a security problem. Logs are kept for a long time, many people can read them, and they get copied to other systems. Secrets and personal data must never reach them.

**Fix** (`src/config/logger.ts`): strip `params:` from every error before it's logged, and log the safe underlying database message instead (`duplicate key value violates unique constraint "users_email_unique"`).

**Check it stays fixed:**
```logql
count_over_time({app="gatepass"} |= "params:" [1h])     # should return nothing
```

### Issue 4: errors were labelled with the wrong route

**Found with:** the request-rate panel's legend showed `/register 500` next to `/api/auth/register 201`, as if they were two different endpoints.

**Diagnosis:** Express clears `req.baseUrl` (the `/api/auth` part) when an error escapes the router, and the request logger reads it after that. Errors were therefore filed under a different route from the successes, so per-route error ratios were wrong.

**Fix** (`src/middleware/observe-requests.ts`): a small `recordMount` middleware saves the base URL on the way in.

### Before and after

| | Run 1 | Run 2 (after fixes) |
|---|---|---|
| k6 checks passed | 98.74% | **100%** |
| `http_req_failed` | 1.24% | **0%** |
| `level="error"` log lines | 644 | **0** |
| Double sign-up | 201 + 500 on `/register` | **201 + 409 on `/api/auth/register`** |
| Malformed JSON | 500 | **400** |
| Lines containing `params:` | yes | **none** |
| p95, users / jobs | 44ms / 10ms | 39ms / 8ms |

---

## 6. Other things the run showed, and what you'd do

These aren't bugs, but they're what you'd raise at a review.

**The DLQ grew by hundreds of messages.** This was expected here, since the test sets 5% of jobs to fail. In production, any growth in the DLQ means messages failed three times and stopped being retried. Real fixes:
- Alert when `sqs_queue_messages{queue="gatepass-jobs-dlq", state="waiting"} > 0`.
- Log the failure reason (the worker already logs `job failed` with `error` and `attempt`).
- Build a "redrive" script that sends DLQ messages back to the main queue once the bug is fixed.

**The API used 2.7 CPU cores at peak, and login/register p95 was about 95ms against about 9ms for `/me`.** That's scrypt password hashing, which is deliberately slow so stolen hashes are hard to crack. It runs in Node's thread pool (4 threads by default), so login is the first route to slow down under load. Options, in order: accept it (it's doing its job); raise `UV_THREADPOOL_SIZE`; rate-limit login per IP; run more API replicas on EKS.

**Each 80-second run produced about 37,000 info log lines**, roughly 98% of them successful `/me` and `/jobs` requests. At real traffic, that's your Loki bill. Common fixes: log successful requests at `debug`, keep `warn` and `error` at full volume, and rely on metrics for counting successes. Metrics are far cheaper than logs for "how many".

**Queue `in_flight` peaked at 275 while `waiting` stayed near 0.** The worker kept up, receiving messages as fast as they arrived. If `waiting` starts climbing during a test, the worker is the bottleneck: process messages concurrently or run more workers.

**Event loop lag peaked at about 20ms.** That's healthy. Over 100ms would mean synchronous work is blocking every request.

---

## 7. Cheat sheet

| Question | Query |
|---|---|
| Traffic right now | `sum by (route) (rate(http_request_duration_seconds_count[1m]))` |
| Error ratio | `sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[1m])) / sum(rate(http_request_duration_seconds_count[1m]))` |
| Slow routes | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))` |
| Worker keeping up? | `sqs_queue_messages{queue="gatepass-jobs", state="waiting"}` |
| Anything in the DLQ? | `sqs_queue_messages{queue="gatepass-jobs-dlq", state="waiting"}` |
| Memory leak? | `process_resident_memory_bytes` over hours: a sawtooth is fine; a line that only goes up is a leak |
| Most common error | `sum by (error) (count_over_time({app="gatepass", level="error"} \| json [1h]))` |
| One request or job's story | `{app="gatepass"} \|= "<messageId or email>"` |
| Slow requests | `{service="api"} \| json \| durationMs > 500` |
| Failing jobs | `{service="issue-ticket"} \| json \| message="job failed"` |
| Secrets in logs? | `{app="gatepass"} \|= "params:"` |

## Load testing

```bash
npm run load                                   # about 80s, needs dev + worker running
BASE_URL=http://other-host npm run load        # point at another environment
```

Edit the `stages` in `load/gatepass.js` to push harder. To find the breaking point, raise the `jobs` target to 1000 and watch which panel turns red first.
