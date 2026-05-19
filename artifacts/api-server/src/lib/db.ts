export { connectDB } from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// PostgreSQL is optional for the core generation features.
// If DATABASE_URL is missing, we disable features that depend on it (tickets, news).
let dbInstance: any = null;

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL.trim().replace(/^["']|["']$/g, ""),
    ssl: { rejectUnauthorized: false },
  });
  dbInstance = drizzle(pool);
} else {
  console.warn("DATABASE_URL not set — PostgreSQL features (tickets, news) will be disabled.");
}

export const db = dbInstance;
