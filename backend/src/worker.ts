import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import client from 'prom-client';
import { logger } from './config/logger.js';
import { jobDuration, jobsProcessed, startMetricsServer } from './config/metrics.js';
import { sqs } from './config/sqs.js';

const QueueUrl = process.env.JOBS_QUEUE_URL;
const queues = { 'gatepass-jobs': QueueUrl, 'gatepass-jobs-dlq': process.env.JOBS_DLQ_URL };

// Read on every Prometheus scrape: how many messages are waiting vs currently being worked on.
new client.Gauge({
  name: 'sqs_queue_messages',
  help: 'Approximate messages in each queue',
  labelNames: ['queue', 'state'] as const,
  async collect() {
    for (const [queue, url] of Object.entries(queues)) {
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

const metricsPort = Number(process.env.WORKER_METRICS_PORT) || 9101;
startMetricsServer(metricsPort);

async function handle(job: { userId?: string; fail?: boolean }) {
  if (job.fail) throw new Error('simulated failure');
}

logger.info('worker polling', { queueUrl: QueueUrl, metricsPort });

while (true) {
  // Long poll: waits up to 20s for a message instead of returning empty immediately.
  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }),
  );

  if (Messages.length > 0) logger.info('received batch', { count: Messages.length });

  for (const msg of Messages) {
    const attempt = Number(msg.Attributes?.ApproximateReceiveCount);
    const endTimer = jobDuration.startTimer();
    let job: { userId?: string; fail?: boolean } = {};
    try {
      job = JSON.parse(msg.Body!);
      // userId on every line lets you follow one user from waiting room -> gatekeeper -> worker in Loki.
      logger.info('processing job', { messageId: msg.MessageId, userId: job.userId, attempt });
      await handle(job);
      // Deleting is how you tell SQS "done". Skip it and the message comes back.
      await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: msg.ReceiptHandle }));
      const seconds = endTimer({ outcome: 'success' });
      jobsProcessed.inc({ outcome: 'success' });
      logger.info('job done', { messageId: msg.MessageId, userId: job.userId, attempt, durationMs: Math.round(seconds * 1000) });
    } catch (err) {
      endTimer({ outcome: 'failure' });
      jobsProcessed.inc({ outcome: 'failure' });
      logger.warn('job failed', { messageId: msg.MessageId, userId: job.userId, attempt, error: (err as Error).message });
    }
  }
}
