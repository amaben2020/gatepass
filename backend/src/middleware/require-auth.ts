import type { NextFunction, Request, Response } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  console.log('SESSION ===>', !req?.session?.userId);
  if (!req?.session?.userId)
    return res.status(401).json({ error: 'Not authenticated' });
  next();
}
