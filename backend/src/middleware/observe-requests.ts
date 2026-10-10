import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import { logger } from '../config/logger.js';

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

// Express clears req.baseUrl when an error bubbles out of a router, so remember it on the way in.
export function recordMount(req: Request, res: Response, next: NextFunction) {
  res.locals.baseUrl = req.baseUrl;
  next();
}

export function observeRequests(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    // Use the route pattern (/api/users/:id), not the raw URL, so each user id doesn't become its own time series.
    const base = res.locals.baseUrl ?? req.baseUrl;
    const route = req.route ? base + (req.route.path === '/' ? '' : req.route.path) : 'unmatched';
    httpDuration.observe({ method: req.method, route, status_code: res.statusCode }, seconds);

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, 'request', {
      method: req.method,
      path: req.originalUrl,
      route,
      status: res.statusCode,
      durationMs: Math.round(seconds * 1000),
    });
  });

  next();
}
