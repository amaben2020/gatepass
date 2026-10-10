import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readCredentials(body: unknown) {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || !EMAIL_RE.test(email))
    return { error: 'A valid email is required' };
  if (typeof password !== 'string' || password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  return { email, password };
}

function startSession(req: Request, userId: string) {
  return new Promise<void>((resolve, reject) => {
    // Regenerate to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve();
    });
  });
}

export class AuthController {
  static async register(req: Request, res: Response) {
    const creds = readCredentials(req.body);
    if ('error' in creds) return res.status(400).json({ error: creds.error });

    const user = await AuthService.register(creds.email, creds.password);
    await startSession(req, user.id);
    res.status(201).json({ user });
  }

  static async login(req: Request, res: Response) {
    const creds = readCredentials(req.body);
    if ('error' in creds) return res.status(400).json({ error: creds.error });

    const user = await AuthService.login(creds.email, creds.password);
    await startSession(req, user.id);
    res.json({ user });
  }

  static async logout(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    res.clearCookie(req.app.get('sessionCookieName'));
    res.status(204).end();
  }

  static async me(req: Request, res: Response) {
    const user = await AuthService.getById(req.session.userId!);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user });
  }
}
