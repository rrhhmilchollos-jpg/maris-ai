CREATE TABLE "agent_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"error_message" text NOT NULL,
	"error_context" text DEFAULT '' NOT NULL,
	"patch" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"language" text DEFAULT 'typescript' NOT NULL,
	"framework" text DEFAULT 'react' NOT NULL,
	"success_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_memory_embedding_idx" ON "agent_memory" USING hnsw ("embedding" vector_cosine_ops);