import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { events, seats } from '../events/events.model.js';

// Created by POST /api/orders when the user taps Pay, before any money moves.
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  seatIds: uuid('seat_ids').array().notNull(), // the seats held at checkout
  amount: integer('amount').notNull(), // minor units, sum of seat prices
  currency: text('currency').notNull().default('ngn'),
  status: text('status')
    .$type<'pending' | 'paid' | 'failed' | 'refund_due' | 'refunded'>()
    .notNull()
    .default('pending'),
  // Unique: one order per PaymentIntent, so the webhook can find its order (and never two).
  paymentIntentId: text('payment_intent_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// Written by the issue-ticket worker, inside the same transaction that marks seats sold and the order paid.
export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  // Unique: the database itself refuses a second ticket for the same seat, whatever the code does.
  seatId: uuid('seat_id')
    .notNull()
    .unique()
    .references(() => seats.id),
  code: text('code').notNull().unique(), // shown as the QR code, checked at the gate
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
