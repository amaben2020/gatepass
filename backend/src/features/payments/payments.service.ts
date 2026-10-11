import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type Stripe from 'stripe';
import { db } from '../../config/db/index.js';
import { logger } from '../../config/logger.js';
import { sqs } from '../../config/sqs.js';
import { stripe } from '../../config/stripe.js';
import { HttpError } from '../../lib/http-error.js';
import { webhookEvents } from './payments.model.js';

// The only Stripe events Gatepass acts on. Everything else is acknowledged and ignored.
const HANDLED = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);

// What the issue-ticket worker receives. Small on purpose: the order row in Postgres is the source of truth.
export type PaymentMessage = {
  stripeEventId: string;
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed';
  paymentIntentId: string;
  orderId: string;
};

export class PaymentsService {
  // Stripe → POST /api/payments/webhook. Must answer fast: slow work happens in the worker, via SQS.
  static async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    // 1. Prove it came from Stripe. constructEvent recomputes the HMAC of the RAW bytes with our webhook secret;
    //    that's why this route gets express.raw() instead of express.json().
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature ?? '', process.env.STRIPE_WEBHOOK_SECRET ?? '');
    } catch {
      throw new HttpError(400, 'BAD_SIGNATURE', 'Webhook signature verification failed');
    }

    if (!HANDLED.has(event.type)) return { received: true, ignored: event.type };

    const intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.orderId;
    if (!orderId) {
      logger.warn('payment event without orderId metadata', { stripeEventId: event.id });
      return { received: true, ignored: 'no orderId' };
    }

    const message: PaymentMessage = {
      stripeEventId: event.id,
      type: event.type as PaymentMessage['type'],
      paymentIntentId: intent.id,
      orderId,
    };

    // 2 + 3 in ONE transaction: record the event id, then enqueue.
    // If SQS fails, the insert rolls back, we answer 500, and Stripe's retry gets a clean second chance.
    // (Insert-then-send without the transaction would mark the event "seen" and lose it for good.)
    const outcome = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({ id: event.id, type: event.type })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length === 0) return 'duplicate' as const; // Stripe sent this event before

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.PAYMENTS_QUEUE_URL,
          MessageBody: JSON.stringify(message),
          MessageGroupId: orderId, // one order's messages: in order, one at a time
          MessageDeduplicationId: event.id, // SQS drops a repeat of this id for 5 minutes
        }),
      );
      return 'queued' as const;
    });

    logger.info(outcome === 'queued' ? 'payment event queued' : 'duplicate webhook ignored', {
      stripeEventId: event.id,
      type: event.type,
      orderId,
    });
    return { received: true, outcome };
  }
}
