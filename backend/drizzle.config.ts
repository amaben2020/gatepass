import { defineConfig } from 'drizzle-kit';

process.loadEnvFile();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/config/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
