import type { NextFunction, Request, Response } from 'express';
import { passKey, redisClient } from '../config/redis/index.js';

// 403, not 401: we know who they are, it just isn't their turn (or their time ran out).
// The app sees code NO_PASS and sends them back to the waiting room.
export async function requirePass(req: Request, res: Response, next: NextFunction) {
  const hasPass = await redisClient.exists(passKey(String(req.params.eventId), req.session.userId!));
  if (!hasPass) {
    return res.status(403).json({ error: "It's not your turn yet, or your time ran out", code: 'NO_PASS' });
  }
  next();
}
