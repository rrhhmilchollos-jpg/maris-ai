import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL("../src/client.ts", import.meta.url);
const source = await readFile(fileURLToPath(sourceUrl), "utf8");

assert.match(source, /const LOCAL_REQUEST_TIMEOUT_MS = Number\(process\.env\.MARIS_LLM_REQUEST_TIMEOUT_MS \|\| 70_000\)/);
assert.match(source, /const LOCAL_MAX_COMPLETION_TOKENS = Number\(process\.env\.MARIS_LLM_MAX_COMPLETION_TOKENS \|\| 512\)/);
assert.match(source, /const controller = new AbortController\(\)/);
assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), LOCAL_REQUEST_TIMEOUT_MS\)/);
assert.match(source, /signal: controller\.signal/);
assert.match(source, /clearTimeout\(timeout\)/);
assert.match(source, /function boundedLocalMaxTokens\(requested\?: number\): number/);
assert.match(source, /max_tokens: boundedLocalMaxTokens\(params\.max_tokens\)/);

console.log("PASS perfil local: timeout cancelable y salida acotada preservados.");
