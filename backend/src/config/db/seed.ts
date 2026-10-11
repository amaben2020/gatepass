// Dev data: `npm run db:seed` (skips if already seeded) or `npm run db:seed -- --reset` (wipes event data first).
import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { events, orders, seatLayouts, seats, tickets, users, webhookEvents } from './schema.js';
import { AuthError, AuthService } from '../../features/auth/auth.service.js';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

const reset = process.argv.includes('--reset');

// Row letter → price in kobo. Rows A–B are VIP; C3 + C4 = ₦40,000, as in the design.
const priceForRow = (row: string) => (row <= 'B' ? 5_000_000 : row <= 'F' ? 2_000_000 : 1_000_000);

// rows=10, seatsPerRow=20 → A1…A20, B1…, J20
const seatLabels = (rows: number, perRow: number) =>
  Array.from({ length: rows }, (_, r) => String.fromCharCode(65 + r)).flatMap((row) =>
    Array.from({ length: perRow }, (_, i) => ({ row, label: `${row}${i + 1}` })),
  );

const existing = await db.select({ id: events.id }).from(events).limit(1);
if (existing.length > 0 && !reset) {
  console.log('Already seeded. Run `npm run db:seed -- --reset` to wipe event data and seed again.');
  await pool.end();
  process.exit(0);
}

await db.transaction(async (tx) => {
  if (reset) {
    // Children before parents, or the foreign keys refuse the delete.
    await tx.delete(tickets);
    await tx.delete(orders);
    await tx.delete(webhookEvents);
    await tx.delete(seats);
    await tx.delete(events);
    await tx.delete(seatLayouts);
  }

  const [layout] = await tx.insert(seatLayouts).values({ name: 'Eko Hall main floor', rows: 10, seatsPerRow: 20 }).returning();

  const created = await tx
    .insert(events)
    .values([
      { name: 'Midnight in Eko', startsAt: new Date('2026-12-19T20:00:00+01:00'), seatLayoutId: layout.id, status: 'on_sale' },
      { name: 'Lagos Jazz Night', startsAt: new Date('2027-02-13T19:00:00+01:00'), seatLayoutId: layout.id, status: 'draft' },
    ])
    .returning();

  for (const event of created) {
    await tx.insert(seats).values(
      seatLabels(layout.rows, layout.seatsPerRow).map(({ row, label }) => ({
        eventId: event.id,
        label,
        price: priceForRow(row),
      })),
    );
  }
});

// A known user to log in as. Re-running is fine: an existing Ada is left as she is.
try {
  await AuthService.register('ada@gatepass.dev', 'supersecret');
} catch (err) {
  if (!(err instanceof AuthError && err.status === 409)) throw err;
}

const summary = await db.select().from(events);
const [ada] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, 'ada@gatepass.dev'));
console.table(summary.map((e) => ({ id: e.id, name: e.name, status: e.status })));
console.log(`Seats per event: 200 · Test user: ${ada.email} / supersecret (id ${ada.id})`);

await pool.end();
