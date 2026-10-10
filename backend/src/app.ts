import connectPgSimple from 'connect-pg-simple';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import session from 'express-session';
import { pool } from './config/db/index.js';
import { logger } from './config/logger.js';
import { register } from './config/metrics.js';
import { rateLimit } from 'express-rate-limit';
import authRoutes from './features/auth/auth.routes.js';
import jobsRoutes from './features/jobs/jobs.routes.js';
import { AuthError } from './features/auth/auth.service.js';
import { observeRequests, recordMount } from './middleware/observe-requests.js';

if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');

const isProd = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'gatepass.sid';
const PgStore = connectPgSimple(session);

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
  standardHeaders: 'draft-8', // draft-6: `RateLimit-*` headers; draft-7 & draft-8: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
  ipv6Subnet: 56, // Set to 60 or 64 to be less aggressive, or 52 or 48 to be more aggressive
  // store: ... , // Redis, Memcached, etc. See below.
  skip: () => !isProd, // Off locally so k6 load tests from one IP aren't throttled.
});

// Behind a load balancer in prod; needed for secure cookies.
if (isProd) app.set('trust proxy', 1);
app.set('sessionCookieName', SESSION_COOKIE);

// Prometheus scrapes this; registered before the request observer so scrapes don't show up as traffic.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.use(observeRequests);

// Before session/body parsing so rejected requests cost nothing.
app.use(limiter);
app.use(express.json());
app.use(
  session({
    name: SESSION_COOKIE,
    store: new PgStore({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use('/api/auth', recordMount, authRoutes);
app.use('/api/jobs', recordMount, jobsRoutes);

type HttpError = Error & { status?: number; expose?: boolean };

app.use((err: HttpError, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthError)
    return res.status(err.status).json({ error: err.message });
  // body-parser errors (malformed JSON, body too large) are the client's fault: 4xx, not 500.
  if (err.expose && err.status && err.status < 500)
    return res.status(err.status).json({ error: err.message });
  logger.error('unhandled error', { err, path: req.originalUrl });
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
