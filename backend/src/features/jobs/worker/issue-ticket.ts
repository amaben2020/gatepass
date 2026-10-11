import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import client from 'prom-client';
import { pool } from '../../../config/db/index.js';
import { flushLogs, logger } from '../../../config/logger.js';
import { startMetricsServer } from '../../../config/metrics.js';
import { redisClient } from '../../../config/redis/index.js';
import { sqs } from '../../../config/sqs.js';
import { consume } from '../../../lib/sqs-consumer.js';
import { FulfilmentService } from '../../orders/fulfilment.service.js';
import type { PaymentMessage } from '../../payments/payments.service.js';

// Two consumers in one process:
//   payments (FIFO)  ← Stripe webhook. The real work: issue tickets or refund. See FulfilmentService.
//   demo-jobs        ← POST /api/jobs. The SQS playground (send {"fail":true} to watch retries → DLQ).
const queues = {
  'gatepass-payments.fifo': process.env.PAYMENTS_QUEUE_URL,
  'gatepass-payments-dlq.fifo': process.env.PAYMENTS_DLQ_URL,
  'gatepass-jobs': process.env.JOBS_QUEUE_URL,
  'gatepass-jobs-dlq': process.env.JOBS_DLQ_URL,
};

// Read on every Prometheus scrape: how many messages are waiting vs currently being worked on.
new client.Gauge({
  name: 'sqs_queue_messages',
  help: 'Approximate messages in each queue',
  labelNames: ['queue', 'state'] as const,
  async collect() {
    for (const [queue, url] of Object.entries(queues)) {
      if (!url) continue;
      const { Attributes = {} } = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        }),
      );
      this.set({ queue, state: 'waiting' }, Number(Attributes.ApproximateNumberOfMessages ?? 0));
      this.set({ queue, state: 'in_flight' }, Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0));
    }
  },
});
startMetricsServer(Number(process.env.WORKER_METRICS_PORT) || 9101);

async function demoJob(job: { fail?: boolean }) {
  if (job.fail) throw new Error('simulated failure');
}

// pm2 sends SIGINT on stop/restart. Each loop finishes its current long poll (≤20s) and exits.
let running = true;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (running = false));
const isRunning = () => running;

await Promise.all([
  consume<PaymentMessage>({
    name: 'payments',
    queueUrl: process.env.PAYMENTS_QUEUE_URL!,
    handle: (body) => FulfilmentService.handle(body),
    isRunning,
  }),
  consume<{ fail?: boolean }>({ name: 'demo-jobs', queueUrl: process.env.JOBS_QUEUE_URL!, handle: demoJob, isRunning }),
]);

await redisClient.quit();
await pool.end();
logger.info('issue-ticket worker stopped');
await flushLogs();
process.exit(0);
