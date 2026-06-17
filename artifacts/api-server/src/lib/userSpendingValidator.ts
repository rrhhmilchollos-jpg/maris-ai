/**
 * userSpendingValidator.ts
 * 
 * Valida el gasto del usuario y determina qué contenido puede exportar a GitHub.
 * Lógica interna: No mostrar límites al usuario.
 */

import { User } from "../models/User";
import { GeneratedApp } from "../models/GeneratedApp";
import { logger } from "./logger";

// Constantes de negocio (internas)
const MINIMUM_SPENDING_FOR_FULL_EXPORT = 1000; // 1000 euros
const COMPLEXITY_THRESHOLD_FOR_AUTO_UNLOCK = 0.75; // 75% de complejidad

export interface SpendingCheckResult {
  canExportFull: boolean;
  canExportFrontendOnly: boolean;
  totalSpent: number;
  isComplexApp: boolean;
  reason: string;
}

export interface AppComplexityAnalysis {
  score: number; // 0-1
  isComplex: boolean;
  factors: {
    codeLines: number;
    componentsCount: number;
    dependenciesCount: number;
    hasDatabase: boolean;
    hasAuthentication: boolean;
    hasExternalAPIs: boolean;
    hasRealTimeFeatures: boolean;
    hasPaymentIntegration: boolean;
  };
}

/**
 * Obtiene el gasto total del usuario en créditos
 */
export async function getUserTotalSpending(userId: string): Promise<number> {
  try {
    const user = await User.findById(userId);
    if (!user) {
      logger.warn({ userId }, "User not found for spending check");
      return 0;
    }

    // Asumir que el modelo User tiene un campo creditsPurchased o similar
    const totalSpent = (user as any).creditsPurchased || 0;
    return totalSpent;
  } catch (error) {
    logger.error({ error, userId }, "Failed to get user spending");
    return 0;
  }
}

/**
 * Analiza la complejidad de una aplicación
 */
export async function analyzeAppComplexity(
  app: any
): Promise<AppComplexityAnalysis> {
  const frontendCode = app.frontendCode || "";
  const backendCode = app.backendCode || "";
  const fullCode = frontendCode + backendCode;

  // Contar líneas de código
  const codeLines = fullCode.split("\n").length;

  // Contar componentes (búsqueda de patrones React/Vue)
  const componentMatches = fullCode.match(
    /(?:function|const|class)\s+\w+\s*(?:\(|=).*(?:return|render)/g
  );
  const componentsCount = componentMatches ? componentMatches.length : 0;

  // Contar dependencias
  const packageJson = app.packageJson
    ? JSON.parse(app.packageJson)
    : { dependencies: {}, devDependencies: {} };
  const dependenciesCount =
    Object.keys(packageJson.dependencies || {}).length +
    Object.keys(packageJson.devDependencies || {}).length;

  // Detectar características avanzadas
  const hasDatabase =
    /database|mongodb|postgresql|mysql|firebase|supabase/i.test(fullCode);
  const hasAuthentication =
    /auth|login|jwt|oauth|passport|clerk/i.test(fullCode);
  const hasExternalAPIs =
    /fetch|axios|api|http|request|webhook/i.test(fullCode);
  const hasRealTimeFeatures =
    /websocket|socket\.io|realtime|subscription|live/i.test(fullCode);
  const hasPaymentIntegration =
    /stripe|paypal|payment|billing|checkout/i.test(fullCode);

  // Calcular score de complejidad (0-1)
  let complexityScore = 0;

  // Puntuación por líneas de código (máx 0.2)
  complexityScore += Math.min(codeLines / 5000, 0.2);

  // Puntuación por componentes (máx 0.15)
  complexityScore += Math.min(componentsCount / 50, 0.15);

  // Puntuación por dependencias (máx 0.15)
  complexityScore += Math.min(dependenciesCount / 50, 0.15);

  // Puntuación por características (máx 0.35)
  let featureScore = 0;
  if (hasDatabase) featureScore += 0.1;
  if (hasAuthentication) featureScore += 0.1;
  if (hasExternalAPIs) featureScore += 0.05;
  if (hasRealTimeFeatures) featureScore += 0.05;
  if (hasPaymentIntegration) featureScore += 0.05;
  complexityScore += featureScore;

  const isComplex = complexityScore >= COMPLEXITY_THRESHOLD_FOR_AUTO_UNLOCK;

  return {
    score: Math.min(complexityScore, 1),
    isComplex,
    factors: {
      codeLines,
      componentsCount,
      dependenciesCount,
      hasDatabase,
      hasAuthentication,
      hasExternalAPIs,
      hasRealTimeFeatures,
      hasPaymentIntegration,
    },
  };
}

/**
 * Verifica si el usuario puede exportar la app completa a GitHub
 */
export async function checkExportPermissions(
  userId: string,
  app: any
): Promise<SpendingCheckResult> {
  try {
    const totalSpent = await getUserTotalSpending(userId);
    const complexity = await analyzeAppComplexity(app);

    // Determinar permisos
    const canExportFull =
      totalSpent >= MINIMUM_SPENDING_FOR_FULL_EXPORT || complexity.isComplex;
    const canExportFrontendOnly = true; // Siempre permitido

    let reason = "";
    if (canExportFull) {
      if (complexity.isComplex) {
        reason = "App complexity threshold reached - Full export unlocked";
        logger.info(
          { userId, appId: app._id, complexity: complexity.score },
          "Full export unlocked due to app complexity"
        );
      } else {
        reason = "User spending threshold reached - Full export unlocked";
        logger.info(
          { userId, appId: app._id, totalSpent },
          "Full export unlocked due to user spending"
        );
      }
    } else {
      reason = "Frontend-only export available";
      logger.info(
        { userId, appId: app._id, totalSpent, requiredSpending: MINIMUM_SPENDING_FOR_FULL_EXPORT },
        "User restricted to frontend-only export"
      );
    }

    return {
      canExportFull,
      canExportFrontendOnly,
      totalSpent,
      isComplexApp: complexity.isComplex,
      reason,
    };
  } catch (error) {
    logger.error({ error, userId }, "Failed to check export permissions");
    // Por defecto, permitir solo frontend
    return {
      canExportFull: false,
      canExportFrontendOnly: true,
      totalSpent: 0,
      isComplexApp: false,
      reason: "Error checking permissions - Frontend-only export available",
    };
  }
}

/**
 * Filtra el contenido a exportar según permisos
 */
export function filterExportContent(
  app: any,
  canExportFull: boolean
): {
  frontendCode: string;
  backendCode?: string;
  packageJson?: string;
  files?: Record<string, string>;
} {
  const result: any = {
    frontendCode: app.frontendCode || "",
  };

  if (canExportFull) {
    // Exportar todo
    result.backendCode = app.backendCode || "";
    result.packageJson = app.packageJson || "";
    result.files = app.files || {};
  } else {
    // Solo frontend
    logger.info(
      { appId: app._id },
      "Filtering export to frontend-only"
    );
  }

  return result;
}

/**
 * Genera un reporte de análisis de complejidad (solo para logs internos)
 */
export function generateComplexityReport(
  analysis: AppComplexityAnalysis
): string {
  return `
=== APP COMPLEXITY ANALYSIS ===
Complexity Score: ${(analysis.score * 100).toFixed(2)}%
Is Complex: ${analysis.isComplex ? "YES" : "NO"}

Factors:
- Code Lines: ${analysis.factors.codeLines}
- Components: ${analysis.factors.componentsCount}
- Dependencies: ${analysis.factors.dependenciesCount}
- Database: ${analysis.factors.hasDatabase ? "YES" : "NO"}
- Authentication: ${analysis.factors.hasAuthentication ? "YES" : "NO"}
- External APIs: ${analysis.factors.hasExternalAPIs ? "YES" : "NO"}
- Real-time Features: ${analysis.factors.hasRealTimeFeatures ? "YES" : "NO"}
- Payment Integration: ${analysis.factors.hasPaymentIntegration ? "YES" : "NO"}

Threshold for Auto-Unlock: ${(COMPLEXITY_THRESHOLD_FOR_AUTO_UNLOCK * 100).toFixed(2)}%
  `.trim();
}

/**
 * Obtiene información de spending del usuario (sin mostrar el límite)
 */
export async function getUserSpendingInfo(userId: string): Promise<{
  totalSpent: number;
  tier: string;
}> {
  const totalSpent = await getUserTotalSpending(userId);

  let tier = "Basic";
  if (totalSpent >= 5000) tier = "Enterprise";
  else if (totalSpent >= 2000) tier = "Professional";
  else if (totalSpent >= 500) tier = "Advanced";

  return { totalSpent, tier };
}
