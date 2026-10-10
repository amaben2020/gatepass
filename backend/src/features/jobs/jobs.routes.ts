import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { Router } from 'express';
import { logger } from '../../config/logger.js';
import { jobsSent } from '../../config/metrics.js';
import { passKey, QUEUE_KEY, redisClient } from '../../config/redis/index.js';
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

// Happens when the user selects a seat: moves them into the waiting room.
router.post('/waiting-room', async (req, res) => {
  const { userId: uid } = req.body ?? {};

  const userId = uid ?? req.session.userId;
  if (userId === undefined || userId === null || userId === '') {
    return res.status(400).json({ error: 'userId is required' });
  }
  // Redis members are strings; a JSON number here crashes ZADD.
  const member = String(userId);

  // NX below only stops duplicates while queued; once admitted they're out of the set and could rejoin.
  if (await redisClient.exists(passKey(member))) {
    return res.status(409).json({ error: 'Already admitted' });
  }

  // NX: only add if not already queued, so clicking again doesn't send them to the back of the line.
  await redisClient.zAdd(
    QUEUE_KEY,
    { value: member, score: Date.now() },
    { condition: 'NX' },
  );
  const rank = await redisClient.zRank(QUEUE_KEY, member);
  const position = Number(rank) + 1;

  logger.info('joined waiting room', { userId: member, position });
  res.json({ userId: member, position });
});

export default router;
