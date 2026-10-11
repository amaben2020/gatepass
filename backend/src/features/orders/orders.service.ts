import { logger } from '../../config/logger.js';
import { redisClient, seatLockKey, userHoldKey } from '../../config/redis/index.js';
import { stripe, stripeConfigured } from '../../config/stripe.js';
import { HttpError } from '../../lib/http-error.js';
import { EventsRepository } from '../events/events.repository.js';
import { getOnSaleEvent } from '../events/events.service.js';
import { seatLocksHeldBy } from '../events/seats.service.js';
import { OrdersRepository } from './orders.repository.js';

const CURRENCY = 'ngn';

const sameSeats = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export class OrdersService {
  // Tapping Pay: turn the user's held seats into a pending order and a Stripe PaymentIntent.
  // No money moves here. The app uses the returned clientSecret to collect the card; Stripe tells us the result by webhook.
  static async create(eventId: string, userId: string) {
    await getOnSaleEvent(eventId);
    if (!stripeConfigured()) throw new HttpError(503, 'PAYMENTS_NOT_CONFIGURED', 'STRIPE_SECRET_KEY is not set on the server');

    // What the user holds right now, according to Redis. The client never says which seats or what they cost.
    const raw = await redisClient.get(userHoldKey(eventId, userId));
    const seatIds: string[] = raw ? JSON.parse(raw) : [];
    if (seatIds.length === 0) throw new HttpError(409, 'NO_HOLD', 'Hold some seats before paying');
    if (!(await seatLocksHeldBy(eventId, userId, seatIds))) {
      throw new HttpError(409, 'HOLD_EXPIRED', 'Your seat hold has expired. Pick your seats again.');
    }

    // A double-tapped Pay button (or a retry after a dropped connection) gets the same order back, not a second charge.
    const pending = await OrdersRepository.latestPending(userId, eventId);
    if (pending?.paymentIntentId && sameSeats(pending.seatIds, seatIds)) {
      const intent = await stripe.paymentIntents.retrieve(pending.paymentIntentId);
      return this.response(pending.id, intent.client_secret!, pending.amount, eventId, seatIds);
    }

    const rows = await EventsRepository.seatsByIds(eventId, seatIds);
    const amount = rows.reduce((sum, s) => sum + s.price, 0); // prices from Postgres, in kobo
    const order = await OrdersRepository.create({ userId, eventId, seatIds, amount, currency: CURRENCY });

    // metadata.orderId is how the webhook finds this order again.
    // The idempotency key makes Stripe return the same PaymentIntent if this exact call is retried.
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: CURRENCY,
        metadata: { orderId: order.id, eventId, userId },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `order-${order.id}` },
    );
    await OrdersRepository.setPaymentIntent(order.id, intent.id);

    logger.info('order created', { orderId: order.id, eventId, userId, amount, paymentIntentId: intent.id });
    return this.response(order.id, intent.client_secret!, amount, eventId, seatIds);
  }

  // What the "Issuing your tickets" screen polls.
  static async get(orderId: string, userId: string) {
    const order = await OrdersRepository.findById(orderId).catch(() => undefined);
    // Someone else's order looks exactly like a missing one.
    if (!order || order.userId !== userId) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const tickets = order.status === 'paid' ? await OrdersRepository.ticketsWithSeats(order.id) : [];
    return {
      id: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      seats: await OrdersRepository.seatLabels(order.seatIds),
      tickets,
    };
  }

  private static async response(orderId: string, clientSecret: string, amount: number, eventId: string, seatIds: string[]) {
    const ttlMs = await redisClient.pTTL(seatLockKey(eventId, seatIds[0]));
    return {
      orderId,
      clientSecret,
      amount,
      currency: CURRENCY,
      holdExpiresAt: new Date(Date.now() + Math.max(0, ttlMs)).toISOString(),
    };
  }
}
