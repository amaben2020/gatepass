import { setTimeout as sleep } from 'node:timers/promises';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import client from 'prom-client';
import { flushLogs, logger } from '../../../config/logger.js';
import { startMetricsServer, usersAdmitted } from '../../../config/metrics.js';
import { passKey, QUEUE_KEY, redisClient } from '../../../config/redis/index.js';
import { sqs } from '../../../config/sqs.js';

const BATCH_SIZE = 100;
const TICK_MS = 2000;
const PASS_TTL_SECONDS = 600;

new client.Gauge({
  name: 'waiting_room_users',
  help: 'Users currently waiting to be admitted',
  async collect() {
    this.set(await redisClient.zCard(QUEUE_KEY));
  },
});
startMetricsServer(Number(process.env.GATEKEEPER_METRICS_PORT) || 9102);

// Admits the next batch from the waiting room: a 10-minute VIP pass (checked by the payment service) plus an order job.
export const processQueue = async () => {
  // ZPOPMIN reads and removes in one atomic step, so two gatekeepers can never admit the same user.
  const nextUsers = await redisClient.zPopMinCount(QUEUE_KEY, BATCH_SIZE);

  for (const { value: userId, score } of nextUsers) {
    try {
      await redisClient.set(passKey(userId), userId, { EX: PASS_TTL_SECONDS });
      const { MessageId } = await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.JOBS_QUEUE_URL,
          MessageBody: JSON.stringify({ userId }),
        }),
      );
      usersAdmitted.inc();
      logger.info('user admitted', { userId, orderMessageId: MessageId });
    } catch (err) {
      // Put them back at their original place so a transient failure doesn't cost them their spot.
      await redisClient.zAdd(QUEUE_KEY, { value: userId, score });
      logger.error('admit failed, returned to queue', { err, userId });
    }
  }

  return nextUsers.length;
};

// pm2 sends SIGINT on stop/restart: finish the current batch, then exit cleanly.
let running = true;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (running = false));

logger.info('gatekeeper started', { batchSize: BATCH_SIZE, tickMs: TICK_MS });

while (running) {
  const admitted = await processQueue();
  if (admitted > 0) logger.info('batch admitted', { admitted });
  await sleep(TICK_MS);
}

await redisClient.quit();
logger.info('gatekeeper stopped');
await flushLogs();
// Timers (Loki batching, SDK keep-alive sockets) would otherwise keep Node alive until pm2 force-kills it.
process.exit(0);
