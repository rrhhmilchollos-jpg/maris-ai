import mongoose from "mongoose";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set");
}

const MONGODB_URI = process.env.MONGODB_URI;

declare global {
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
  var _pgPool: pg.Pool | undefined;
}

async function connectDB(): Promise<typeof mongoose> {
  if (global._mongooseConnection) {
    return global._mongooseConnection;
  }
  global._mongooseConnection = mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });
  return global._mongooseConnection;
}

// Inicialización de Postgres/Drizzle
const pool = global._pgPool || new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}

export const db = drizzle(pool, { schema });
export { connectDB };
export default connectDB;
export const mongooseConnection = mongoose.connection;
