import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { desc } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../config/db/index.js';
import { sqs } from '../../config/sqs.js';
import { OrdersRepository } from '../orders/orders.repository.js';
import { webhookEvents } from '../payments/payments.model.js';
import { passKey, redisClient, seatLockKey, shoppersKey, userHoldKey, waitingRoomKey } from '../../config/redis/index.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { EventsRepository } from '../events/events.repository.js';

// Development only (app.ts doesn't mount it in production): exposes the Redis state behind the UI
// so the frontend's "Under the hood" panel can show what each click changed.
const router = Router();

router.get('/events/:eventId', requireAuth, async (req, res) => {
  const eventId = String(req.params.eventId);
  const userId = req.session.userId!;

  const [waiting, shopping, rank, passMs, holdRaw] = await redisClient
    .multi()
    .zCard(waitingRoomKey(eventId))
    .zCount(shoppersKey(eventId), Date.now(), '+inf')
    .zRank(waitingRoomKey(eventId), userId)
    .pTTL(passKey(eventId, userId))
    .get(userHoldKey(eventId, userId))
    .exec();

  const heldIds: string[] = holdRaw ? JSON.parse(String(holdRaw)) : [];
  const seats = heldIds.length ? await EventsRepository.seatsByIds(eventId, heldIds) : [];
  const lockTtls = await Promise.all(heldIds.map((id) => redisClient.pTTL(seatLockKey(eventId, id))));
  const allLocks = await redisClient.keys(`seat:{${eventId}}:*`);

  // The parts of the flow the browser never sees: Stripe → webhook → SQS → worker.
  const order = await OrdersRepository.latestForUser(userId, eventId);
  const recentWebhooks = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(5);
  const queueDepth = async (url?: string) => {
    if (!url) return null;
    const { Attributes = {} } = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }),
    );
    return { waiting: Number(Attributes.ApproximateNumberOfMessages ?? 0), inFlight: Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0) };
  };

  res.json({
    order: order && { id: order.id, status: order.status, amount: order.amount, paymentIntentId: order.paymentIntentId },
    webhooks: recentWebhooks.map((w) => ({ id: w.id, type: w.type, receivedAt: w.receivedAt })),
    paymentsQueue: await queueDepth(process.env.PAYMENTS_QUEUE_URL),
    paymentsDlq: await queueDepth(process.env.PAYMENTS_DLQ_URL),
    keys: {
      waitingRoom: waitingRoomKey(eventId),
      pass: passKey(eventId, userId),
      hold: userHoldKey(eventId, userId),
    },
    waitingCount: waiting,
    shoppingCount: shopping,
    seatLocksTotal: allLocks.length,
    you: {
      userId,
      position: typeof rank === 'number' ? rank + 1 : null,
      passTtlSeconds: typeof passMs === 'number' && passMs > 0 ? Math.round(passMs / 1000) : null,
      held: seats.map((s) => ({
        label: s.label,
        ttlSeconds: Math.max(0, Math.round(Number(lockTtls[heldIds.indexOf(s.id)]) / 1000)),
      })),
    },
  });
});

export default router;
