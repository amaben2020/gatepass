import { setTimeout as sleep } from 'node:timers/promises';
import client from 'prom-client';
import { pool } from '../../../config/db/index.js';
import { flushLogs, logger } from '../../../config/logger.js';
import { startMetricsServer, usersAdmitted } from '../../../config/metrics.js';
import { passKey, redisClient, shoppersKey, waitingRoomKey } from '../../../config/redis/index.js';
import { MAX_SHOPPERS, PASS_TTL_SECONDS } from '../../events/events.config.js';
import { EventsRepository } from '../../events/events.repository.js';

const TICK_MS = 2000;

// One atomic step per event: no request can see a user half-admitted, and two gatekeepers can't admit the same user.
// KEYS[1] waiting room, KEYS[2] shoppers
// ARGV: now (ms), max shoppers, pass ttl (s), pass key prefix
// Returns the admitted userIds.
const ADMIT_SCRIPT = `
-- Shoppers whose pass expired free their slot.
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
local free = tonumber(ARGV[2]) - redis.call('ZCARD', KEYS[2])
if free <= 0 then return {} end

-- Front of the line first. ZPOPMIN returns { user, score, user, score, ... }.
local popped = redis.call('ZPOPMIN', KEYS[1], free)
local expiresAt = tonumber(ARGV[1]) + tonumber(ARGV[3]) * 1000
local admitted = {}
for i = 1, #popped, 2 do
  local userId = popped[i]
  redis.call('SET', ARGV[4] .. userId, '1', 'EX', ARGV[3])
  redis.call('ZADD', KEYS[2], expiresAt, userId)
  table.insert(admitted, userId)
end
return admitted
`;

new client.Gauge({
  name: 'waiting_room_users',
  help: 'Users waiting in line vs shopping (admitted), per event',
  labelNames: ['event_id', 'state'] as const,
  async collect() {
    this.reset();
    for (const eventId of await EventsRepository.onSaleIds()) {
      this.set({ event_id: eventId, state: 'waiting' }, await redisClient.zCard(waitingRoomKey(eventId)));
      this.set({ event_id: eventId, state: 'shopping' }, await redisClient.zCount(shoppersKey(eventId), Date.now(), '+inf'));
    }
  },
});
startMetricsServer(Number(process.env.GATEKEEPER_METRICS_PORT) || 9102);

// Admits as many people as there are free shopping slots. Never touches seats: that's the user's next step.
export const admitNext = async (eventId: string) => {
  const admitted = (await redisClient.eval(ADMIT_SCRIPT, {
    keys: [waitingRoomKey(eventId), shoppersKey(eventId)],
    arguments: [String(Date.now()), String(MAX_SHOPPERS), String(PASS_TTL_SECONDS), passKey(eventId, '')],
  })) as string[];

  for (const userId of admitted) {
    usersAdmitted.inc();
    logger.info('user admitted', { eventId, userId });
  }
  return admitted.length;
};

// pm2 sends SIGINT on stop/restart: finish the current tick, then exit cleanly.
let running = true;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (running = false));

logger.info('gatekeeper started', { maxShoppers: MAX_SHOPPERS, passTtlSeconds: PASS_TTL_SECONDS, tickMs: TICK_MS });

while (running) {
  // Only events on sale have a line worth processing.
  for (const eventId of await EventsRepository.onSaleIds()) {
    const admitted = await admitNext(eventId);
    if (admitted > 0) logger.info('batch admitted', { eventId, admitted });
  }
  await sleep(TICK_MS);
}

await redisClient.quit();
await pool.end();
logger.info('gatekeeper stopped');
await flushLogs();
// Timers (Loki batching, SDK keep-alive sockets) would otherwise keep Node alive until pm2 force-kills it.
process.exit(0);
