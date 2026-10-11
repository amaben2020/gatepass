import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

// A venue's seating plan, reused by every event held there. Seats are generated from it per event.
export const seatLayouts = pgTable('seat_layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  rows: integer('rows').notNull(),
  seatsPerRow: integer('seats_per_row').notNull(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  seatLayoutId: uuid('seat_layout_id')
    .notNull()
    .references(() => seatLayouts.id),
  status: text('status').$type<'draft' | 'on_sale' | 'sold_out' | 'ended'>().notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// One row per seat per event. Holds live in Redis (seat:{eventId}:{label}, with a TTL), not here:
// the DB only records the final outcome, 'sold'.
export const seats = pgTable(
  'seats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    label: text('label').notNull(), // "C3"
    price: integer('price').notNull(), // minor units (kobo): ₦20,000 = 2000000
    status: text('status').$type<'available' | 'sold'>().notNull().default('available'),
  },
  (t) => [unique('seats_event_label_unique').on(t.eventId, t.label)],
);

export type Event = typeof events.$inferSelect;
export type Seat = typeof seats.$inferSelect;
