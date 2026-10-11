import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Every Stripe webhook delivery we've accepted. The primary key IS Stripe's event id ("evt_..."),
// so inserting a duplicate fails: that's the dedupe.
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // "payment_intent.succeeded", ...
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});
