import mongoose from "mongoose";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set");
}

const MONGODB_URI = process.env.MONGODB_URI.trim().replace(/^["']|["']$/g, "");

declare global {
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
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

export { connectDB };
export default connectDB;
