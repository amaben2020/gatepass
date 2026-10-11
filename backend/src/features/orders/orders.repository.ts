import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/db/index.js';
import { seats } from '../events/events.model.js';
import { orders, tickets, type Order } from './orders.model.js';

export class OrdersRepository {
  static async create(values: { userId: string; eventId: string; seatIds: string[]; amount: number; currency: string }) {
    const [order] = await db.insert(orders).values(values).returning();
    return order;
  }

  static async findById(id: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return order;
  }

  static async latestPending(userId: string, eventId: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.eventId, eventId), eq(orders.status, 'pending')))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return order;
  }

  static async latestForUser(userId: string, eventId: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.eventId, eventId)))
      .orderBy(desc(orders.createdAt))
      .limit(1);
    return order;
  }

  static async setPaymentIntent(id: string, paymentIntentId: string) {
    await db.update(orders).set({ paymentIntentId }).where(eq(orders.id, id));
  }

  static async setStatus(id: string, status: Order['status']) {
    await db.update(orders).set({ status }).where(eq(orders.id, id));
  }

  static async ticketsWithSeats(orderId: string) {
    return db
      .select({ code: tickets.code, seatLabel: seats.label })
      .from(tickets)
      .innerJoin(seats, eq(seats.id, tickets.seatId))
      .where(eq(tickets.orderId, orderId))
      .orderBy(seats.label);
  }

  static async seatLabels(seatIds: string[]) {
    const rows = await db.select({ label: seats.label }).from(seats).where(inArray(seats.id, seatIds));
    return rows.map((r) => r.label).sort();
  }
}
