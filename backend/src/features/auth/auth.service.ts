import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PublicUser, User } from './auth.model.js';
import { AuthRepository } from './auth.repository.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Postgres error code for a UNIQUE constraint violation. Drizzle wraps the pg error in `cause`.
const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code === '23505';

function toPublicUser({ passwordHash: _, ...user }: User): PublicUser {
  return user;
}

export class AuthService {
  static async register(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (await AuthRepository.findByEmail(normalized)) {
      throw new AuthError('Email already registered', 409);
    }
    // The check above is a fast path; two concurrent sign-ups can both pass it, so the DB constraint is the real guard.
    try {
      const user = await AuthRepository.create({
        email: normalized,
        passwordHash: await hashPassword(password),
      });
      return toPublicUser(user);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AuthError('Email already registered', 409);
      throw err;
    }
  }

  static async login(email: string, password: string) {
    const user = await AuthRepository.findByEmail(email.trim().toLowerCase());
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new AuthError('Invalid email or password', 401);
    }
    return toPublicUser(user);
  }

  static async getById(id: string) {
    const user = await AuthRepository.findById(id);
    return user ? toPublicUser(user) : undefined;
  }
}
