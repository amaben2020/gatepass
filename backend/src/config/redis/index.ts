import { createClient } from 'redis';
import { logger } from '../logger.js';

export const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.on('error', (err) => logger.error('redis client error', { err }));
await redisClient.connect();

// The {eventId} braces are a Redis Cluster "hash tag": only the part inside {} decides which shard a key lives on,
// so all of one event's keys sit together and a Lua script can touch them in one atomic step.

// The line. Member = userId, score = join time (ms): lowest score is the front.
export const waitingRoomKey = (eventId: string) => `waiting:{${eventId}}`;

// Who is shopping right now. Member = userId, score = when their pass expires (ms). Lets the gatekeeper count free slots.
export const shoppersKey = (eventId: string) => `shoppers:{${eventId}}`;

// Proof of admission. Its TTL is the window to pick seats and pay.
export const passKey = (eventId: string, userId: string) => `pass:{${eventId}}:${userId}`;

// One per held seat. Value = the userId holding it, TTL = the hold timer.
export const seatLockKey = (eventId: string, seatId: string) => `seat:{${eventId}}:${seatId}`;

// The seat ids a user currently holds for an event, so a new selection can replace the old one.
export const userHoldKey = (eventId: string, userId: string) => `hold:{${eventId}}:${userId}`;
