import { Request, Response } from 'express';
import { redisClient } from '../../config/redis/index.js';
import { logger } from '../../config/logger.js';

export class LearningController {
  static async joinWaitingRoom(req: Request, res: Response) {
    // 1. join: get in line (order matters)
    console.log('req?.session ===>', req?.session);
    const userId = req?.session.userId ?? '';
    // TODO: Validate with zod
    const { eventId } = req.body;
    const REDIS_QUEUE = `waiting:${eventId}`;
    await redisClient.zAdd(
      REDIS_QUEUE,
      {
        value: userId,
        score: Date.now(),
      },
      {
        NX: true,
      },
    );
    // remove the user from the queue and set to pass
    const next = await redisClient.ZPOPMIN_COUNT(REDIS_QUEUE, 50);
    // 2. gatekeeper, every few seconds: let the next 50 in
    for (const { value } of next) {
      await redisClient.set(`pass:${eventId}:${value}`, '1', { EX: 600 });
      logger.log('2', 'You are in the waiting room');
    }
    // grant the user entry to verified queue redis.exists
    const allowed = await redisClient.exists(`pass:${eventId}:${userId}`);
    console.log('Allowed');
    if (allowed) {
      return res
        .status(202)
        .json({ message: `User ${userId} moved to waiting room` });
    } else {
      return res.status(403).json({
        message: 'Join the waiting room first',
      });
    }
  }

  static async viewRoom(req: Request, res: Response) {
    res.status(200).json({
      message: 'Fine',
    });
  }
}
