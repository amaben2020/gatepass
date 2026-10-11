import { logger } from '../../config/logger.js';
import { redisClient, seatLockKey, userHoldKey } from '../../config/redis/index.js';
import { HttpError } from '../../lib/http-error.js';
import { MAX_SEATS_PER_USER, SEAT_HOLD_SECONDS } from './events.config.js';
import { EventsRepository } from './events.repository.js';
import { getOnSaleEvent, isUuid } from './events.service.js';

export type SeatStatus = 'available' | 'held' | 'yours' | 'sold';

// Redis runs a Lua script as one atomic step: no other command runs in between, so the check and the write can't race.
// KEYS[1]          the user's current hold list
// KEYS[2 .. n+1]   locks for the seats wanted now
// KEYS[n+2 .. ]    locks from the user's previous hold (to release)
// ARGV: userId, ttl seconds, n, wanted seat ids as JSON
// Returns 0 on success, or the 1-based position of the first wanted seat someone else holds.
const HOLD_SCRIPT = `
local n = tonumber(ARGV[3])

-- 1. All or nothing: if any wanted seat belongs to someone else, change nothing.
for i = 2, n + 1 do
  local holder = redis.call('GET', KEYS[i])
  if holder and holder ~= ARGV[1] then return i - 1 end
end

-- 2. Release the previous selection, but only locks that are still ours.
--    (A lock that expired and was taken by someone else must not be deleted.)
for i = n + 2, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end
end

-- 3. Take every wanted seat with a fresh timer and remember the selection.
for i = 2, n + 1 do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
if n > 0 then
  redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[2])
else
  redis.call('DEL', KEYS[1])
end
return 0
`;

// Deletes each key only if it still holds this user's id: a lock that expired and was re-taken by
// someone else must survive. KEYS = locks, ARGV[1] = userId.
const RELEASE_SCRIPT = `
local released = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    released = released + 1
  end
end
return released
`;

// Used after payment (seats are now sold, or refunded): the locks have done their job.
export async function releaseSeatLocks(eventId: string, userId: string, seatIds: string[]) {
  const released = await redisClient.eval(RELEASE_SCRIPT, {
    keys: seatIds.map((id) => seatLockKey(eventId, id)),
    arguments: [userId],
  });
  // The hold list is only ever this user's key, so a plain DEL is safe.
  await redisClient.del(userHoldKey(eventId, userId));
  return Number(released);
}

// Are all of these seats still locked by this user right now?
export async function seatLocksHeldBy(eventId: string, userId: string, seatIds: string[]) {
  if (seatIds.length === 0) return false;
  const holders = await redisClient.mGet(seatIds.map((id) => seatLockKey(eventId, id)));
  return holders.every((h) => h === userId);
}

// "C10" after "C9", not after "C1".
const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label[0].localeCompare(b.label[0]) || Number(a.label.slice(1)) - Number(b.label.slice(1));

async function previousHold(eventId: string, userId: string): Promise<string[]> {
  const raw = await redisClient.get(userHoldKey(eventId, userId));
  return raw ? JSON.parse(raw) : [];
}

// Runs the script with `wanted` as the new selection (empty = release everything).
async function replaceHold(eventId: string, userId: string, wanted: string[]) {
  const previous = await previousHold(eventId, userId);
  const result = await redisClient.eval(HOLD_SCRIPT, {
    keys: [
      userHoldKey(eventId, userId),
      ...wanted.map((id) => seatLockKey(eventId, id)),
      ...previous.map((id) => seatLockKey(eventId, id)),
    ],
    arguments: [userId, String(SEAT_HOLD_SECONDS), String(wanted.length), JSON.stringify(wanted)],
  });
  return Number(result);
}

export class SeatsService {
  // Postgres knows what's sold; Redis knows what's held. The map merges the two.
  static async seatMap(eventId: string, userId: string) {
    await getOnSaleEvent(eventId);
    const rows = (await EventsRepository.seatsForEvent(eventId)).sort(byLabel);

    // MGET: every seat's lock in one round trip instead of 200.
    const holders = rows.length ? await redisClient.mGet(rows.map((s) => seatLockKey(eventId, s.id))) : [];

    const seats = rows.map((seat, i) => {
      const holder = holders[i];
      const status: SeatStatus =
        seat.status === 'sold' ? 'sold' : holder === null ? 'available' : holder === userId ? 'yours' : 'held';
      return { id: seat.id, label: seat.label, price: seat.price, status };
    });
    return { eventId, seats };
  }

  // Holds exactly `seatIds` for this user, replacing whatever they held before.
  static async hold(eventId: string, userId: string, seatIds: unknown) {
    await getOnSaleEvent(eventId);

    // The client only says WHICH seats. Price and availability come from the database.
    if (!Array.isArray(seatIds) || seatIds.length === 0 || !seatIds.every(isUuid)) {
      throw new HttpError(400, 'INVALID_SEATS', 'seatIds must be a non-empty array of seat ids');
    }
    const wanted = [...new Set(seatIds)];
    if (wanted.length > MAX_SEATS_PER_USER) {
      throw new HttpError(400, 'TOO_MANY_SEATS', `You can hold up to ${MAX_SEATS_PER_USER} seats`);
    }

    const rows = await EventsRepository.seatsByIds(eventId, wanted);
    if (rows.length !== wanted.length) throw new HttpError(404, 'SEAT_NOT_FOUND', 'One or more seats do not exist for this event');
    const sold = rows.filter((s) => s.status === 'sold');
    if (sold.length) throw new HttpError(409, 'SEAT_SOLD', `Already sold: ${sold.map((s) => s.label).join(', ')}`);

    const conflict = await replaceHold(eventId, userId, wanted);
    if (conflict > 0) {
      const taken = rows.find((s) => s.id === wanted[conflict - 1]);
      throw new HttpError(409, 'SEAT_TAKEN', `${taken?.label ?? 'A seat'} is being held by someone else`);
    }

    const held = rows.sort(byLabel).map((s) => ({ id: s.id, label: s.label, price: s.price }));
    const total = held.reduce((sum, s) => sum + s.price, 0);
    // A timestamp, not "600 seconds": the app's countdown stays right however long the response took to arrive.
    const expiresAt = new Date(Date.now() + SEAT_HOLD_SECONDS * 1000).toISOString();

    logger.info('seats held', { eventId, userId, seats: held.map((s) => s.label).join(','), total });
    return { seats: held, total, expiresAt };
  }

  static async release(eventId: string, userId: string) {
    await replaceHold(eventId, userId, []);
    logger.info('seats released', { eventId, userId });
  }
}
