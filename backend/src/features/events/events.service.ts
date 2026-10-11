import { HttpError } from '../../lib/http-error.js';
import { EventsRepository } from './events.repository.js';

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Every waiting-room and seat action starts here. A malformed id is a 404 too: Postgres would reject it as a uuid (500).
export async function getOnSaleEvent(eventId: string) {
  const event = isUuid(eventId) ? await EventsRepository.findById(eventId) : undefined;
  if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found');
  if (event.status !== 'on_sale') throw new HttpError(409, 'NOT_ON_SALE', 'Tickets for this event are not on sale');
  return event;
}
