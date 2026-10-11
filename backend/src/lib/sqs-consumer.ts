import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../config/logger.js';
import { jobDuration, jobsProcessed } from '../config/metrics.js';
import { sqs } from '../config/sqs.js';

type Consumer<T> = {
  name: string; // label for logs and metrics
  queueUrl: string;
  handle: (body: T, meta: { messageId: string; attempt: number }) => Promise<void>;
  isRunning: () => boolean;
};

// The SQS contract in one loop: receive → handle → delete. A handler that throws leaves the message alone,
// so SQS makes it visible again after the visibility timeout (a retry), and after maxReceiveCount moves it to the DLQ.
export async function consume<T>({ name, queueUrl, handle, isRunning }: Consumer<T>) {
  logger.info('consuming queue', { queue: name, queueUrl });

  while (isRunning()) {
    // Long poll: waits up to 20s for a message instead of returning empty immediately.
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    if (Messages.length > 0) logger.info('received batch', { queue: name, count: Messages.length });

    for (const msg of Messages) {
      const meta = { messageId: msg.MessageId!, attempt: Number(msg.Attributes?.ApproximateReceiveCount) };
      const endTimer = jobDuration.startTimer({ queue: name });
      try {
        const body = JSON.parse(msg.Body!) as T;
        logger.info('processing message', { queue: name, ...meta, ...(body as object) });
        await handle(body, meta);
        // Deleting is how you tell SQS "done". Skip it and the message comes back.
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
        const seconds = endTimer({ outcome: 'success' });
        jobsProcessed.inc({ queue: name, outcome: 'success' });
        logger.info('message done', { queue: name, ...meta, durationMs: Math.round(seconds * 1000) });
      } catch (err) {
        endTimer({ outcome: 'failure' });
        jobsProcessed.inc({ queue: name, outcome: 'failure' });
        logger.warn('message failed', { queue: name, ...meta, err });
      }
    }
  }
}
