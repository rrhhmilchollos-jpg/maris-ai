import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI?.trim().replace(/^["']|["']$/g, "");

if (!MONGODB_URI) {
  console.warn("MONGODB_URI not set — Database connection will fail when attempted.");
}

declare global {
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
}

async function connectDB(): Promise<typeof mongoose> {
  if (global._mongooseConnection) {
    return global._mongooseConnection;
  }
  if (!MONGODB_URI) {
    throw new Error("Cannot connect to MongoDB: MONGODB_URI is not defined.");
  }
  global._mongooseConnection = mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });
  return global._mongooseConnection;
}

export { connectDB };
export default connectDB;
