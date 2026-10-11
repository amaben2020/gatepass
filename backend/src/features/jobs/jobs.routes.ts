import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { Router } from 'express';
import { logger } from '../../config/logger.js';
import { jobsSent } from '../../config/metrics.js';
import { sqs } from '../../config/sqs.js';

const router = Router();

// Send any JSON body to the queue. Include "fail": true to watch it land in the DLQ.
router.post('/', async (req, res) => {
  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.JOBS_QUEUE_URL,
      MessageBody: JSON.stringify(req.body ?? {}),
    }),
  );
  jobsSent.inc();
  logger.info('job queued', { messageId: result.MessageId });
  res.status(202).json({ messageId: result.MessageId });
});

export default router;
