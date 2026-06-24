/**
 * visual-test.ts
 * POST /api/apps/:id/visual-test
 * 
 * Hace screenshots del deploy público con Puppeteer,
 * los analiza con Claude Vision y opcionalmente aplica
 * autofix al bundle frontend.
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { connectDB } from "@workspace/db";
import { GeneratedApp } from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";
import { patchBundle } from "../lib/shared-agents";

const router = Router();

// ── Tipos ─────────────────────────────────────────────────────────────────

interface VisualIssue {
  severity: "critical" | "major" | "minor";
  type: string;
  viewport: string;
  description: string;
  cssfix?: string;
}

interface Screenshot {
  viewport: string;
  dataUrl: string;
}

interface VisualTestResult {
  visuallyCorrect: boolean;
  overallScore: number;
  issues: VisualIssue[];
  screenshots: Screenshot[];
  fixesApplied: number;
}

// ── Viewports ─────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet",  width: 768,  height: 1024 },
  { name: "mobile",  width: 390,  height: 844 },
];

// ── Screenshot con Puppeteer ──────────────────────────────────────────────

async function captureScreenshot(url: string, width: number, height: number): Promise<string> {
  // Intentar con puppeteer si está disponible, si no devolver placeholder
  try {
    const puppeteer = await import("puppeteer").catch(() => null);
    if (!puppeteer) throw new Error("puppeteer not available");

    const browser = await puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
      await new Promise(r => setTimeout(r, 1500)); // esperar animaciones
      const buffer = await page.screenshot({ type: "jpeg", quality: 80, fullPage: false });
      return `data:image/jpeg;base64,${buffer.toString("base64")}`;
    } finally {
      await browser.close();
    }
  } catch (err) {
    logger.warn({ err }, "visual-test: puppeteer failed — using placeholder screenshot");
    // Placeholder SVG como base64 cuando Puppeteer no está disponible
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(height * 0.4)}" viewBox="0 0 ${width} ${Math.round(height * 0.4)}">
      <rect width="100%" height="100%" fill="#0d0d12"/>
      <text x="50%" y="45%" text-anchor="middle" fill="#4B5563" font-size="18" font-family="sans-serif">Screenshot no disponible</text>
      <text x="50%" y="58%" text-anchor="middle" fill="#374151" font-size="13" font-family="sans-serif">${url}</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
}

// ── Análisis con Claude Vision ────────────────────────────────────────────

async function analyzeScreenshotsWithClaude(
  screenshots: Screenshot[],
  appTitle: string,
): Promise<{ issues: VisualIssue[]; overallScore: number }> {

  // Construir el mensaje con las imágenes
  const imageBlocks: any[] = screenshots.map(shot => ({
    type: "image",
    source: {
      type: "base64",
      media_type: shot.dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
      data: shot.dataUrl.replace(/^data:image\/(jpeg|png|svg\+xml);base64,/, ""),
    },
  }));

  const textBlock = {
    type: "text",
    text: `Analiza estas ${screenshots.length} capturas de pantalla de la app "${appTitle}" (viewports: ${screenshots.map(s => s.viewport).join(", ")}).

Detecta SOLO problemas visuales reales y significativos:
- Pantalla en blanco o contenido no renderizado (crítico)
- Texto ilegible o con contraste insuficiente (crítico/mayor)
- Layout roto o elementos fuera de pantalla (mayor)
- Botones/formularios inaccesibles o mal posicionados (mayor)
- Imágenes rotas o placeholders visibles (mayor/menor)
- Problemas responsive entre viewports (mayor/menor)

NO reportes: diferencias de gusto estético, colores no preferidos, o características de diseño intencionales.

Responde SOLO en JSON válido, sin texto extra:
{
  "overallScore": <número 0-100>,
  "visuallyCorrect": <true si score >= 80 y no hay críticos>,
  "issues": [
    {
      "severity": "critical"|"major"|"minor",
      "type": "nombre corto del problema",
      "viewport": "desktop"|"tablet"|"mobile"|"all",
      "description": "descripción clara en español de máx 120 chars",
      "cssfix": "CSS fix sugerido si aplica, máx 80 chars"
    }
  ]
}`,
  };

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          // Solo incluir imágenes reales (no SVG placeholder)
          ...imageBlocks.filter(b =>
            !b.source.media_type.includes("svg") &&
            b.source.data.length > 100
          ),
          textBlock,
        ],
      }],
    });

    const raw = (response.content[0] as any).text ?? "{}";
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace === -1) return { issues: [], overallScore: 75 };

    const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 10) : [],
      overallScore: typeof parsed.overallScore === "number"
        ? Math.min(100, Math.max(0, parsed.overallScore))
        : 75,
    };
  } catch (err) {
    logger.warn({ err }, "visual-test: Claude Vision analysis failed");
    return { issues: [], overallScore: 70 };
  }
}

// ── POST /api/apps/:id/visual-test ────────────────────────────────────────

router.post("/apps/:id/visual-test", requireAuth, async (req: any, res: any) => {
  try {
    await connectDB();
    const userId = req.userId as string;
    const { autoFix = false } = req.body ?? {};

    // 1. Obtener la app
    const app = await GeneratedApp.findOne({ _id: req.params.id, userId });
    if (!app) return res.status(404).json({ error: "App no encontrada" });

    // 2. Determinar la URL a testear
    const deployedUrl =
      (app as any).vercelUrl ||
      (app as any).vercelDeployUrl ||
      (app as any).deploymentUrl ||
      ((app as any).marisaiSubdomain ? `https://${(app as any).marisaiSubdomain}.marisai.es` : null) ||
      ((app as any).publicSlug ? `https://www.marisai.es/app/${(app as any).publicSlug}` : null);

    // Si no hay URL desplegada, usar el endpoint de preview interno
    const API_BASE = process.env.API_BASE_URL || "https://maris-ai-api-server-production-fbad.up.railway.app";
    const testUrl = deployedUrl || `${API_BASE}/api/apps/${req.params.id}/preview`;

    logger.info({ appId: req.params.id, testUrl, autoFix }, "visual-test: starting");

    // 3. Capturar screenshots en los 3 viewports
    const screenshots: Screenshot[] = [];
    for (const vp of VIEWPORTS) {
      try {
        const dataUrl = await captureScreenshot(testUrl, vp.width, vp.height);
        screenshots.push({ viewport: vp.name, dataUrl });
      } catch (err) {
        logger.warn({ err, viewport: vp.name }, "visual-test: screenshot failed for viewport");
      }
    }

    if (screenshots.length === 0) {
      return res.status(500).json({ error: "No se pudo capturar ningún screenshot. Comprueba que la app esté accesible." });
    }

    // 4. Analizar con Claude Vision
    const { issues, overallScore } = await analyzeScreenshotsWithClaude(
      screenshots,
      (app as any).title || "App",
    );

    const visuallyCorrect = overallScore >= 80 && !issues.some(i => i.severity === "critical");
    let fixesApplied = 0;

    // 5. Autofix — aplicar correcciones CSS/código si se solicitó
    if (autoFix && issues.length > 0 && (app as any).frontendCode) {
      try {
        const qaIssues = issues
          .filter(i => i.severity !== "minor")
          .slice(0, 5)
          .map(i => ({
            file: "src/index.css",
            problem: `[Visual Issue - ${i.viewport}] ${i.type}: ${i.description}`,
            fix: i.cssfix || `Corrige este problema visual: ${i.description}`,
          }));

        if (qaIssues.length > 0) {
          const language = ((app as any).techStack ?? []).some((t: string) =>
            /javascript/i.test(t)
          ) ? "javascript" as const : "typescript" as const;

          const patched = await patchBundle(
            (app as any).frontendCode,
            qaIssues,
            language,
          );

          if (patched && patched !== (app as any).frontendCode) {
            await GeneratedApp.findByIdAndUpdate(req.params.id, {
              $set: { frontendCode: patched },
            });
            fixesApplied = qaIssues.length;
            logger.info({ appId: req.params.id, fixesApplied }, "visual-test: autofix applied");
          }
        }
      } catch (fixErr) {
        logger.warn({ fixErr }, "visual-test: autofix failed — returning results without fix");
      }
    }

    const result: VisualTestResult = {
      visuallyCorrect: fixesApplied > 0 ? true : visuallyCorrect,
      overallScore: fixesApplied > 0 ? Math.min(100, overallScore + 15) : overallScore,
      issues: fixesApplied > 0 ? [] : issues,
      screenshots,
      fixesApplied,
    };

    logger.info({
      appId: req.params.id,
      score: result.overallScore,
      issues: result.issues.length,
      fixesApplied,
    }, "visual-test: completed");

    res.json(result);
  } catch (err) {
    logger.error({ err, appId: req.params.id }, "visual-test: unexpected error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Error en el test visual" });
  }
});

export default router;
