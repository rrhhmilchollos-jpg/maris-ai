import { pgTable, serial, text, integer, timestamp, vector, index } from "drizzle-orm/pg-core";

export const agentMemory = pgTable(
  "agent_memory",
  {
    id: serial("id").primaryKey(),
    errorMessage: text("error_message").notNull(),
    errorContext: text("error_context").notNull().default(""),
    patch: text("patch").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    language: text("language").notNull().default("typescript"),
    framework: text("framework").notNull().default("react"),
    successCount: integer("success_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    embeddingIdx: index("agent_memory_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  }),
);

export type AgentMemoryEntry = typeof agentMemory.$inferSelect;
export type InsertAgentMemoryEntry = typeof agentMemory.$inferInsert;
