import { styleText } from 'node:util';
import winston from 'winston';
import LokiTransport from 'winston-loki';

const service = process.env.SERVICE_NAME ?? 'api';

type Style = Parameters<typeof styleText>[0];

const LEVEL_STYLE: Record<string, Style> = {
  error: ['bold', 'red'],
  warn: ['bold', 'yellow'],
  info: ['bold', 'green'],
  debug: ['bold', 'blue'],
};

const statusStyle = (status: number): Style =>
  status >= 500 ? 'red' : status >= 400 ? 'yellow' : status >= 300 ? 'cyan' : 'green';

const durationStyle = (ms: number): Style => (ms >= 1000 ? 'red' : ms >= 100 ? 'yellow' : 'gray');

const fields = (meta: Record<string, unknown>) =>
  Object.entries(meta)
    .map(([k, v]) => `${styleText('cyan', k)}${styleText('gray', '=')}${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');

// 13:20:43.183 INFO  api     POST /api/jobs 202 24ms
// 13:20:43.295 WARN  worker  job failed messageId=06ee... attempt=2 error=simulated failure
const pretty = winston.format.printf(({ timestamp, level, message, service: svc, stack, ...meta }) => {
  const time = styleText('gray', String(timestamp).slice(11, 23));
  const lvl = styleText(LEVEL_STYLE[level] ?? 'white', level.toUpperCase().padEnd(5));
  const tag = styleText('magenta', String(svc).padEnd(7));

  let body: string;
  if (message === 'request') {
    const { method, path, status, durationMs, route: _r, ...rest } = meta as Record<string, any>;
    body = [
      styleText('bold', method),
      path,
      styleText(statusStyle(status), String(status)),
      styleText(durationStyle(durationMs), `${durationMs}ms`),
      fields(rest),
    ].join(' ');
  } else {
    body = `${message} ${fields(meta)}`;
  }

  return `${time} ${lvl} ${tag} ${body.trimEnd()}${stack ? `\n${styleText('red', String(stack))}` : ''}`;
});

// Errors don't JSON-serialize (they become {}), so lift message and stack out of `err`.
// Drizzle appends "params: ..." (emails, password hashes) to failed-query messages: strip it.
const stripParams = (text = '') => text.replace(/\nparams: .*/, '');

const unwrapError = winston.format((info) => {
  if (info.err instanceof Error) {
    const { err } = info;
    info.error = stripParams(err.message);
    info.stack = stripParams(err.stack);
    if (err.cause instanceof Error) info.cause = err.cause.message;
    delete info.err;
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  defaultMeta: { service },
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), unwrapError()),
  transports: [
    new winston.transports.Console({
      // LOG_FORMAT=json for real deployments, where a log collector parses stdout.
      format: process.env.LOG_FORMAT === 'json' ? winston.format.json() : pretty,
    }),
  ],
});

// Ships logs to Loki so they're searchable in Grafana. Labels are what you filter on: {app="gatepass", service="api"}.
const loki = process.env.LOKI_URL
  ? new LokiTransport({
      host: process.env.LOKI_URL,
      labels: { app: 'gatepass', service },
      format: winston.format.json(),
      json: true,
      batching: true,
      interval: 2,
      onConnectionError: (err) => console.error('loki push failed', err),
      // Its default SIGINT hook calls process.exit(), cutting off our own graceful shutdown. Call flushLogs() instead.
      gracefulShutdown: false,
    })
  : undefined;

if (loki) logger.add(loki);

// Push any batched lines to Loki before the process exits.
export const flushLogs = async () => {
  await loki?.flush();
};
