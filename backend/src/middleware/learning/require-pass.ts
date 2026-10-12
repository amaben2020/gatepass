import { NextFunction, Request, Response } from 'express';
import { redisClient } from '../../config/redis/index.js';

// this is for all learning routes that must check that user is in the pass queue
export const requireLearningPassMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const eventId = 1;
  const userId = req.session.userId;
  const QUEUE_KEY = `pass:${eventId}:${userId}`;
  const isExists = await redisClient.exists(QUEUE_KEY);

  console.log('IS EXISTS', isExists);

  if (!isExists) {
    return res.status(403).json({
      message: 'forbidden',
    });
  }

  next();
};
