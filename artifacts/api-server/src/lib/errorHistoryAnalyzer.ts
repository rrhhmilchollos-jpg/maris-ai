/**
 * errorHistoryAnalyzer.ts — Maris AI Error History Analyzer
 *
 * Analyzes runtime errors from AppRuntimeErrors collection and cross-references
 * them with the AgentMemory patch database to:
 *   1. Prevent recurring errors by injecting known fixes into the patcher prompt.
 *   2. Identify patterns in errors across users/apps to improve future generations.
 *   3. Auto-suggest proactive fixes when a new app is similar to one that had errors.
 *
 * Also implements the Auto-Refactoring Proactive Agent that runs in the background
 * to optimize generated code for performance, accessibility, and security.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import { connectDB } from "./db";
import { logger } from "./logger";
import { createZocoMessageWithFallback } from "./shared-agents";

const ANALYZER_MODEL = "zoco-flash";

// ─── Error Pattern Schema ─────────────────────────────────────────────────────

export interface IErrorPattern extends Document {
  pattern: string;           // Regex or keyword pattern that identifies this error class
  errorClass: string;        // Human-readable class name (e.g., "missing-import", "hook-order")
  occurrenceCount: number;   // How many times this pattern has been seen
  resolvedCount: number;     // How many times it was auto-resolved
  proactiveFix: string;      // Code snippet or instruction to prevent this error
  affectedFiles: string[];   // File patterns where this error typically occurs
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

const ErrorPatternSchema = new Schema<IErrorPattern>(
  {
    pattern: { type: String, required: true, unique: true },
    errorClass: { type: String, required: true },
    occurrenceCount: { type: Number, default: 1 },
    resolvedCount: { type: Number, default: 0 },
    proactiveFix: { type: String, default: "" },
    affectedFiles: { type: [String], default: [] },
    language: { type: String, default: "typescript" },
  },
  { timestamps: true },
);

const ErrorPattern: Model<IErrorPattern> =
  mongoose.models.ErrorPattern ||
  mongoose.model<IErrorPattern>("ErrorPattern", ErrorPatternSchema);

// ─── Refactoring Job Schema ───────────────────────────────────────────────────

export interface IRefactoringJob extends Document {
  appId: string;
  userId: string;
  status: "pending" | "running" | "completed" | "failed";
  suggestions: RefactoringSuggestion[];
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefactoringSuggestion {
  type: "performance" | "accessibility" | "security" | "code-quality" | "seo";
  severity: "low" | "medium" | "high";
  description: string;
  filePath?: string;
  before?: string;
  after?: string;
}

const RefactoringJobSchema = new Schema<IRefactoringJob>(
  {
    appId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    status: { type: String, enum: ["pending", "running", "completed", "failed"], default: "pending" },
    suggestions: [
      {
        type: { type: String, enum: ["performance", "accessibility", "security", "code-quality", "seo"] },
        severity: { type: String, enum: ["low", "medium", "high"] },
        description: { type: String },
        filePath: { type: String },
        before: { type: String },
        after: { type: String },
      },
    ],
    appliedAt: { type: Date },
  },
  { timestamps: true },
);

const RefactoringJob: Model<IRefactoringJob> =
  mongoose.models.RefactoringJob ||
  mongoose.model<IRefactoringJob>("RefactoringJob", RefactoringJobSchema);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a new error occurrence and update the error pattern database.
 * Called whenever a runtime error is captured from an app.
 */
export async function recordErrorOccurrence(
  errorMessage: string,
  language: string = "typescript",
): Promise<void> {
  try {
    await connectDB();
    // Normalize the error message to extract the pattern
    const pattern = normalizeErrorPattern(errorMessage);
    const errorClass = classifyError(errorMessage);
    await ErrorPattern.findOneAndUpdate(
      { pattern },
      {
        $inc: { occurrenceCount: 1 },
        $setOnInsert: { errorClass, language },
        $set: { updatedAt: new Date() },
      },
      { upsert: true, new: true },
    );
    logger.debug({ pattern, errorClass }, "errorHistoryAnalyzer: recorded error occurrence");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "errorHistoryAnalyzer.recordErrorOccurrence failed (silenced)");
  }
}

/**
 * Record a successful resolution of an error pattern.
 * Stores the fix so future generations can proactively avoid the error.
 */
export async function recordErrorResolution(
  errorMessage: string,
  fix: string,
  language: string = "typescript",
): Promise<void> {
  try {
    await connectDB();
    const pattern = normalizeErrorPattern(errorMessage);
    await ErrorPattern.findOneAndUpdate(
      { pattern },
      {
        $inc: { resolvedCount: 1 },
        $set: { proactiveFix: fix.slice(0, 2000), updatedAt: new Date() },
      },
      { upsert: true },
    );
    logger.debug({ pattern }, "errorHistoryAnalyzer: recorded error resolution");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "errorHistoryAnalyzer.recordErrorResolution failed (silenced)");
  }
}

/**
 * Get the top recurring errors and their proactive fixes.
 * Used to inject into the Frontend and Patcher agent prompts.
 */
export async function getProactiveFixes(
  language: string = "typescript",
  limit: number = 5,
): Promise<string> {
  try {
    await connectDB();
    const patterns = await ErrorPattern.find({
      language,
      resolvedCount: { $gt: 0 },
      proactiveFix: { $ne: "" },
    })
      .sort({ occurrenceCount: -1 })
      .limit(limit)
      .lean();
    if (patterns.length === 0) return "";
    const lines = patterns.map(
      (p) => `- [${p.errorClass}] (${p.occurrenceCount} ocurrencias): ${p.proactiveFix.slice(0, 200)}`,
    );
    return `\n\nERROR HISTORY — FIXES PROACTIVOS (errores frecuentes en generaciones anteriores — evítalos activamente):
${lines.join("\n")}\n`;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "errorHistoryAnalyzer.getProactiveFixes failed (silenced)");
    return "";
  }
}

/**
 * Schedule a background auto-refactoring analysis for a given app.
 * Non-blocking — runs asynchronously after successful generation.
 */
export async function scheduleAutoRefactoring(
  appId: string,
  userId: string,
  frontendCode: string,
): Promise<void> {
  // Fire and forget — don't await
  _runAutoRefactoringAnalysis(appId, userId, frontendCode).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err), appId }, "autoRefactoring analysis failed (silenced)");
  });
}

/**
 * Get pending refactoring suggestions for an app.
 */
export async function getRefactoringSuggestions(
  appId: string,
): Promise<RefactoringSuggestion[]> {
  try {
    await connectDB();
    const job = await RefactoringJob.findOne(
      { appId, status: "completed" },
      { suggestions: 1 },
    )
      .sort({ createdAt: -1 })
      .lean();
    return job?.suggestions ?? [];
  } catch {
    return [];
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _runAutoRefactoringAnalysis(
  appId: string,
  userId: string,
  frontendCode: string,
): Promise<void> {
  await connectDB();
  const job = await RefactoringJob.create({ appId, userId, status: "running" });
  try {
    const codeSnippet = frontendCode.slice(0, 8000);
    const systemPrompt = `Eres el agente de auto-refactorización de Maris AI. Analiza el código React/TypeScript/Tailwind proporcionado y devuelve EXACTAMENTE un JSON con sugerencias de mejora.

DEVUELVE:
{
  "suggestions": [
    {
      "type": "performance|accessibility|security|code-quality|seo",
      "severity": "low|medium|high",
      "description": "descripción concisa del problema y la solución",
      "filePath": "ruta del archivo afectado (opcional)",
      "before": "código problemático (máx 200 chars, opcional)",
      "after": "código mejorado (máx 200 chars, opcional)"
    }
  ]
}

REGLAS:
- Máximo 6 sugerencias. Solo las más impactantes.
- Prioriza: accesibilidad (alt text, aria-label, roles), rendimiento (React.memo, useMemo, lazy loading), seguridad (sanitización de inputs, no dangerouslySetInnerHTML sin sanitizar).
- Sé específico y accionable. No sugerencias genéricas.
- Responde SOLO con el JSON.`;

    const response = await createZocoMessageWithFallback("error-analysis", ANALYZER_MODEL, {
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: `Analiza este código:\n\`\`\`\n${codeSnippet}\n\`\`\`` }],
    });
    const text = (response.content?.[0] as any)?.text ?? "";
    const parsed = parseRefactoringOutput(text);
    await RefactoringJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "completed",
        suggestions: parsed,
        updatedAt: new Date(),
      },
    });
    logger.info({ appId, suggestions: parsed.length }, "autoRefactoring: analysis completed");
  } catch (err) {
    await RefactoringJob.findByIdAndUpdate(job._id, { $set: { status: "failed" } });
    throw err;
  }
}

function parseRefactoringOutput(raw: string): RefactoringSuggestion[] {
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj?.suggestions)) return obj.suggestions.slice(0, 6);
  } catch { /* fall through */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]);
    return Array.isArray(obj?.suggestions) ? obj.suggestions.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function normalizeErrorPattern(errorMessage: string): string {
  return errorMessage
    .replace(/line \d+/gi, "line N")
    .replace(/column \d+/gi, "column N")
    .replace(/'[^']{1,50}'/g, "'X'")
    .replace(/"[^"]{1,50}"/g, '"X"')
    .replace(/\b\d+\b/g, "N")
    .trim()
    .slice(0, 200);
}

function classifyError(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (/cannot find module|module not found|import/.test(lower)) return "missing-import";
  if (/is not defined|undefined/.test(lower)) return "undefined-reference";
  if (/type error|type '.*' is not assignable/.test(lower)) return "type-mismatch";
  if (/hook|usestate|useeffect|rules of hooks/.test(lower)) return "hook-violation";
  if (/jsx|tsx|react/.test(lower)) return "jsx-syntax";
  if (/syntax error|unexpected token/.test(lower)) return "syntax-error";
  if (/cors|network|fetch|api/.test(lower)) return "network-error";
  if (/permission|auth|401|403/.test(lower)) return "auth-error";
  return "general-error";
}
