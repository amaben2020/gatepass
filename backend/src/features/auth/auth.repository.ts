import { eq } from 'drizzle-orm';
import { db } from '../../config/db/index.js';
import { users, type NewUser } from './auth.model.js';

export class AuthRepository {
  static async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  static async findById(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  static async create(data: NewUser) {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }
}
