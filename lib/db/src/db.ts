import mongoose from "mongoose";

const sanitizeMongoUri = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return undefined;
  if (!/^mongodb(?:\+srv)?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
};

const mongoCandidates = [
  { name: "MONGODB_URI", uri: sanitizeMongoUri(process.env.MONGODB_URI) },
  { name: "DATABASE_URL", uri: sanitizeMongoUri(process.env.DATABASE_URL) },
].filter((candidate): candidate is { name: string; uri: string } => Boolean(candidate.uri));

if (mongoCandidates.length === 0) {
  console.warn("No MongoDB connection string found — Database connection will fail when attempted.");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseConnection: Promise<typeof mongoose> | undefined;
  // eslint-disable-next-line no-var
  var _mongooseConnectionSource: string | undefined;
}

async function connectDB(): Promise<typeof mongoose> {
  if (global._mongooseConnection) {
    return global._mongooseConnection;
  }
  if (mongoCandidates.length === 0) {
    throw new Error("Cannot connect to MongoDB: neither MONGODB_URI nor a MongoDB DATABASE_URL is defined.");
  }

  let lastError: unknown;
  for (const candidate of mongoCandidates) {
    try {
      console.log(`Connecting to MongoDB using ${candidate.name}`);
      const connection = mongoose.connect(candidate.uri, {
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      });
      global._mongooseConnection = connection;
      global._mongooseConnectionSource = candidate.name;
      return await connection;
    } catch (error) {
      lastError = error;
      global._mongooseConnection = undefined;
      global._mongooseConnectionSource = undefined;
      try {
        await mongoose.disconnect();
      } catch {
        // Ignore cleanup errors before trying the next configured MongoDB URL.
      }
      console.error(`MongoDB connection failed using ${candidate.name}; trying next configured source if available.`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to connect to MongoDB with all configured sources.");
}

export { connectDB };
export default connectDB;
