import { createClient } from 'redis';
import { logger } from '../logger.js';

// Initialize Redis Client
export const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('redis client error', { err }));
await redisClient.connect();

export const QUEUE_KEY = 'concert:ticket:queue';

// Set by the gatekeeper on admission; the payment service only accepts users holding one.
export const passKey = (userId: string) => `vip-accept-pay-${userId}`;
