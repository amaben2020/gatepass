import { logger } from '../../config/logger.js';
import { passKey, redisClient, waitingRoomKey } from '../../config/redis/index.js';
import { getOnSaleEvent } from './events.service.js';

export type WaitingRoomStatus =
  | { status: 'waiting'; position: number }
  | { status: 'admitted'; expiresAt: string }
  | { status: 'not_in_line' };

export class WaitingRoomService {
  // Safe to call twice: someone already in line or admitted just gets their current status back.
  static async join(eventId: string, userId: string): Promise<WaitingRoomStatus> {
    await getOnSaleEvent(eventId);

    const current = await this.status(eventId, userId);
    if (current.status !== 'not_in_line') return current;

    // NX: never overwrite a score, so nobody can lose their place by joining again.
    await redisClient.zAdd(waitingRoomKey(eventId), { value: userId, score: Date.now() }, { condition: 'NX' });
    const joined = await this.status(eventId, userId);
    logger.info('joined waiting room', { eventId, userId, ...joined });
    return joined;
  }

  // What the app polls every few seconds.
  static async status(eventId: string, userId: string): Promise<WaitingRoomStatus> {
    // One round trip for both reads. The gatekeeper moves a user from the line to a pass atomically,
    // so a user is always in exactly one of the two states (or neither).
    const [passMs, rank] = await redisClient
      .multi()
      .pTTL(passKey(eventId, userId))
      .zRank(waitingRoomKey(eventId), userId)
      .exec();

    if (typeof passMs === 'number' && passMs > 0) {
      return { status: 'admitted', expiresAt: new Date(Date.now() + passMs).toISOString() };
    }
    if (typeof rank === 'number') return { status: 'waiting', position: rank + 1 };
    return { status: 'not_in_line' };
  }
}
