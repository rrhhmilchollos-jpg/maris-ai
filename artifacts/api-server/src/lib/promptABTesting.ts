/**
 * promptABTesting.ts — A/B testing automático de system prompts
 *
 * Cuando una generación falla o tiene baja calidad, prueba variaciones
 * del system prompt para ese tipo de app y guarda qué versión funciona mejor.
 *
 * FUNCIONAMIENTO:
 * 1. Cada tipo de app (landing, saas, crm, juego...) tiene variantes de prompt
 * 2. Se selecciona aleatoriamente con epsilon-greedy (10% exploración, 90% explotación)
 * 3. Cuando una generación termina, se registra si fue exitosa o no
 * 4. Con el tiempo, los prompts ganadores se usan más frecuentemente
 */

import { connectDB } from "./db";
import { logger } from "./logger";
import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Modelo de resultados A/B ─────────────────────────────────────────────────

interface IPromptVariant extends Document {
  variantId: string;
  appKind: string;
  promptModifier: string;
  description: string;
  uses: number;
  successes: number;
  avgQualityScore: number;
  createdAt: Date;
  updatedAt: Date;
}

const PromptVariantSchema = new Schema<IPromptVariant>({
  variantId:     { type: String, required: true, unique: true },
  appKind:       { type: String, required: true, index: true },
  promptModifier: { type: String, required: true },
  description:   { type: String, default: "" },
  uses:          { type: Number, default: 0 },
  successes:     { type: Number, default: 0 },
  avgQualityScore: { type: Number, default: 0 },
}, { timestamps: true });

const PromptVariant: Model<IPromptVariant> =
  mongoose.models.PromptVariant ||
  mongoose.model<IPromptVariant>("PromptVariant", PromptVariantSchema);

// ─── Variantes de prompts por tipo de app ────────────────────────────────────

const DEFAULT_VARIANTS: Record<string, Array<{ id: string; modifier: string; desc: string }>> = {
  landing: [
    { id: "landing_conversion", modifier: "\n\nPRIORITY: Maximize conversion. Hero with clear CTA above the fold. Social proof section. Pricing section with annual/monthly toggle. FAQ addressing objections.", desc: "Enfocado en conversión" },
    { id: "landing_visual", modifier: "\n\nPRIORITY: Stunning visual impact. Full-viewport hero with scroll animations. Bold typography (text-6xl+). Premium feel.", desc: "Enfocado en impacto visual" },
    { id: "landing_minimal", modifier: "\n\nPRIORITY: Clean minimalism. White space is your friend. One accent color. Maximum 3 sections. Every word earns its place.", desc: "Minimalista y directo" },
  ],
  fullstack: [
    { id: "fullstack_crud", modifier: "\n\nPRIORITY: Complete CRUD functionality with real data tables, filters, search, pagination. Every list has create/edit/delete.", desc: "CRUD completo" },
    { id: "fullstack_dashboard", modifier: "\n\nPRIORITY: Dashboard-first. KPI cards at top, charts in the middle, activity feed on the side. Real mock data.", desc: "Dashboard primero" },
    { id: "fullstack_userflow", modifier: "\n\nPRIORITY: User flow clarity. Clear onboarding, settings page, profile management. Navigation that makes sense.", desc: "Flujo de usuario claro" },
  ],
  saas: [
    { id: "saas_b2b", modifier: "\n\nPRIORITY: B2B SaaS patterns. Team management, roles/permissions, billing section, usage metrics, API key management.", desc: "B2B patterns" },
    { id: "saas_viral", modifier: "\n\nPRIORITY: Viral loops. Referral system, share features, public profiles, activity feeds.", desc: "Viralidad" },
  ],
  game: [
    { id: "game_arcade", modifier: "\n\nPRIORITY: Arcade feel. Score display, lives/health, increasing difficulty, particle effects on events, satisfying feedback.", desc: "Arcade clásico" },
    { id: "game_modern", modifier: "\n\nPRIORITY: Modern game UX. Smooth animations, pause menu, settings, local leaderboard, achievements.", desc: "Moderno con achievements" },
  ],
};

// ─── Selector epsilon-greedy ──────────────────────────────────────────────────

export async function selectPromptVariant(appKind: string): Promise<{
  variantId: string;
  modifier: string;
}> {
  try {
    await connectDB();

    // Seed variantes por defecto si no existen
    const kindKey = appKind.includes("game") ? "game" : appKind.includes("saas") ? "saas" : appKind.includes("landing") ? "landing" : "fullstack";
    const defaults = DEFAULT_VARIANTS[kindKey] || DEFAULT_VARIANTS.fullstack;

    for (const v of defaults) {
      await PromptVariant.findOneAndUpdate(
        { variantId: v.id },
        { $setOnInsert: { variantId: v.id, appKind: kindKey, promptModifier: v.modifier, description: v.desc } },
        { upsert: true, new: false }
      );
    }

    // Epsilon-greedy: 10% exploración aleatoria, 90% explotación del mejor
    const EPSILON = 0.1;
    const variants = await PromptVariant.find({ appKind: kindKey }).lean() as any[];
    if (variants.length === 0) return { variantId: "default", modifier: "" };

    let selected: any;
    if (Math.random() < EPSILON || variants.every(v => v.uses === 0)) {
      // Exploración: variante aleatoria
      selected = variants[Math.floor(Math.random() * variants.length)];
    } else {
      // Explotación: mejor tasa de éxito (con Laplace smoothing)
      selected = variants.reduce((best, v) => {
        const scoreA = (best.successes + 1) / (best.uses + 2);
        const scoreB = (v.successes + 1) / (v.uses + 2);
        return scoreB > scoreA ? v : best;
      });
    }

    // Registrar uso
    await PromptVariant.findOneAndUpdate(
      { variantId: selected.variantId },
      { $inc: { uses: 1 } }
    );

    logger.info({ variantId: selected.variantId, appKind: kindKey }, "promptABTesting: variant selected");
    return { variantId: selected.variantId, modifier: selected.promptModifier };
  } catch (err) {
    logger.warn({ err }, "promptABTesting: selectPromptVariant failed — using default");
    return { variantId: "default", modifier: "" };
  }
}

/**
 * Registrar el resultado de una generación para actualizar las estadísticas.
 */
export async function recordVariantResult(
  variantId: string,
  success: boolean,
  qualityScore: number,
): Promise<void> {
  if (variantId === "default") return;
  try {
    await connectDB();
    const variant = await PromptVariant.findOne({ variantId }).lean() as any;
    if (!variant) return;

    const newAvgScore = variant.uses > 0
      ? (variant.avgQualityScore * (variant.uses - 1) + qualityScore) / variant.uses
      : qualityScore;

    await PromptVariant.findOneAndUpdate(
      { variantId },
      {
        $inc: { successes: success ? 1 : 0 },
        $set: { avgQualityScore: Math.round(newAvgScore) },
      }
    );
    logger.info({ variantId, success, qualityScore }, "promptABTesting: result recorded");
  } catch (err) {
    logger.warn({ err }, "promptABTesting: recordVariantResult failed");
  }
}
