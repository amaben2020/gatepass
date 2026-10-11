import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/db/index.js';
import { events, seats } from './events.model.js';

export class EventsRepository {
  static async list() {
    return db.select().from(events).orderBy(events.startsAt);
  }

  static async findById(id: string) {
    const [event] = await db.select().from(events).where(eq(events.id, id)).limit(1);
    return event;
  }

  static async onSaleIds() {
    const rows = await db.select({ id: events.id }).from(events).where(eq(events.status, 'on_sale'));
    return rows.map((r) => r.id);
  }

  static async seatsForEvent(eventId: string) {
    return db.select().from(seats).where(eq(seats.eventId, eventId));
  }

  static async seatsByIds(eventId: string, seatIds: string[]) {
    // eventId in the WHERE too: a seat id from another event must not count as found.
    return db
      .select()
      .from(seats)
      .where(and(eq(seats.eventId, eventId), inArray(seats.id, seatIds)));
  }
}
