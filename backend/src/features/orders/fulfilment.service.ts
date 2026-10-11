import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/db/index.js';
import { logger } from '../../config/logger.js';
import { passKey, redisClient, shoppersKey } from '../../config/redis/index.js';
import { stripe } from '../../config/stripe.js';
import { seats } from '../events/events.model.js';
import { releaseSeatLocks, seatLocksHeldBy } from '../events/seats.service.js';
import type { PaymentMessage } from '../payments/payments.service.js';
import { orders, tickets, type Order } from './orders.model.js';
import { OrdersRepository } from './orders.repository.js';

class SeatsUnavailable extends Error {}

const ticketCode = () => `GP-${randomBytes(5).toString('hex').toUpperCase()}`;

// Runs in the issue-ticket worker for each message from the payments FIFO queue.
// Returning = done (the message is deleted). Throwing = not done (SQS redelivers; after 3 tries → DLQ).
export class FulfilmentService {
  static async handle(msg: PaymentMessage) {
    const order = await OrdersRepository.findById(msg.orderId);
    if (!order) throw new Error(`order ${msg.orderId} not found`); // retry, then DLQ for a human to look at

    // Idempotency, second layer (the webhook_events table was the first): a finished order is never touched again.
    if (order.status !== 'pending') {
      logger.info('order already handled, skipping', { orderId: order.id, status: order.status, stripeEventId: msg.stripeEventId });
      return;
    }

    if (msg.type === 'payment_intent.payment_failed') {
      // No money moved, nothing to refund. Give the seats back.
      await OrdersRepository.setStatus(order.id, 'failed');
      await releaseSeatLocks(order.eventId, order.userId, order.seatIds);
      logger.warn('payment failed, seats released', { orderId: order.id });
      return;
    }

    // Paid. Are the seats still ours? If the 10-minute hold ran out before Stripe confirmed, someone else may have them.
    if (!(await seatLocksHeldBy(order.eventId, order.userId, order.seatIds))) {
      return this.refund(order, 'hold expired before payment completed');
    }

    let issued: { code: string; seatId: string }[];
    try {
      // ONE transaction: all three writes happen, or none do. Every query uses `tx`, never `db`.
      issued = await db.transaction(async (tx) => {
        // Only seats still 'available' flip to 'sold'. Fewer rows back = someone got there first → roll back.
        const sold = await tx
          .update(seats)
          .set({ status: 'sold' })
          .where(and(inArray(seats.id, order.seatIds), eq(seats.status, 'available')))
          .returning({ id: seats.id });
        if (sold.length !== order.seatIds.length) throw new SeatsUnavailable();

        // tickets.seat_id is UNIQUE: even a logic bug can't issue two tickets for one seat.
        const rows = await tx
          .insert(tickets)
          .values(sold.map((s) => ({ orderId: order.id, seatId: s.id, code: ticketCode() })))
          .returning({ code: tickets.code, seatId: tickets.seatId });

        // status = 'pending' in the WHERE: if another worker somehow finished this order first, update 0 rows and roll back.
        const paid = await tx
          .update(orders)
          .set({ status: 'paid' })
          .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
          .returning({ id: orders.id });
        if (paid.length === 0) throw new Error('order changed while issuing tickets');

        return rows;
      });
    } catch (err) {
      if (err instanceof SeatsUnavailable) return this.refund(order, 'seats were sold to someone else');
      throw err;
    }

    // After COMMIT only: things a rollback couldn't undo.
    await releaseSeatLocks(order.eventId, order.userId, order.seatIds); // seats are 'sold' in Postgres now
    await redisClient.zRem(shoppersKey(order.eventId), order.userId); // frees a shopping slot for the next person
    await redisClient.del(passKey(order.eventId, order.userId));
    logger.info('tickets issued', { orderId: order.id, userId: order.userId, tickets: issued.map((t) => t.code).join(',') });
    // A real email would be enqueued here (never inside the transaction: you can't un-send an email).
    logger.info('ticket email sent (simulated)', { orderId: order.id, userId: order.userId });
  }

  private static async refund(order: Order, reason: string) {
    // The idempotency key makes a retried refund a no-op at Stripe: the customer is refunded once.
    await stripe.refunds.create({ payment_intent: order.paymentIntentId! }, { idempotencyKey: `refund-${order.id}` });
    await OrdersRepository.setStatus(order.id, 'refunded');
    await releaseSeatLocks(order.eventId, order.userId, order.seatIds);
    logger.warn('payment refunded', { orderId: order.id, reason });
  }
}
