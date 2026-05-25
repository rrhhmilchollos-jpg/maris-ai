// db.ts — MongoDB only. PostgreSQL/Drizzle has been removed.
// All data access goes through Mongoose models exported from @workspace/db/schema.
export { connectDB } from "@workspace/db";
