import { index, json, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export * from '../../features/auth/auth.model.js';
export * from '../../features/events/events.model.js';
export * from '../../features/orders/orders.model.js';
export * from '../../features/payments/payments.model.js';

// Shape required by connect-pg-simple; owned here so migrations create it.
export const sessions = pgTable(
  'session',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6 }).notNull(),
  },
  (t) => [index('IDX_session_expire').on(t.expire)],
);
