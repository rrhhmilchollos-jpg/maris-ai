// Re-export zod schemas + their inferred TS types from api.ts. We deliberately
// do NOT re-export from ./generated/types — every schema in the OpenAPI spec
// already exists as a zod const in api.ts and TS picks up its inferred type
// via `typeof Schema._output`. Re-exporting from types/ produces duplicate
// identifier errors when an endpoint has query parameters (orval emits both
// a zod schema for `XParams` and a TS interface for `XParams`).
export * from "./generated/api";
