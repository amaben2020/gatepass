import { createServer } from 'node:http';
import client from 'prom-client';

// CPU, memory, heap, event loop lag, GC, open handles: the "resource usage" metrics.
client.collectDefaultMetrics();

export const register = client.register;

export const jobsSent = new client.Counter({
  name: 'jobs_sent_total',
  help: 'Messages sent to the jobs queue',
});

export const jobsProcessed = new client.Counter({
  name: 'jobs_processed_total',
  help: 'Messages handled by the worker',
  labelNames: ['outcome'] as const,
});

export const jobDuration = new client.Histogram({
  name: 'job_processing_duration_seconds',
  help: 'Time spent handling one message',
  labelNames: ['outcome'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const usersAdmitted = new client.Counter({
  name: 'users_admitted_total',
  help: 'Users let out of the waiting room by the gatekeeper',
});

// Workers aren't Express apps, so they expose /metrics on their own small server for Prometheus to scrape.
export const startMetricsServer = (port: number) =>
  createServer(async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.end(await register.metrics());
  }).listen(port);
