/**
 * GitHub OAuth routes
 * ─────────────────────────────────────────────────────────────────────────────
 * GET  /api/github/connect          → Redirige al usuario a GitHub OAuth
 * GET  /api/github/callback         → Callback de GitHub OAuth (guarda token)
 * GET  /api/github/status           → Devuelve si el usuario tiene GitHub conectado
 * DELETE /api/github/disconnect     → Desconecta la cuenta de GitHub del usuario
 * POST /api/github/push/:appId      → Sube el proyecto a GitHub como repositorio
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { connectDB } from "../lib/db";
import { User, GeneratedApp } from "@workspace/db/schema";
import { logger } from "../lib/logger";
// fetch es nativo en Node.js 18+ — no se necesita node-fetch
const router: IRouter = Router();

/**
 * Genera un workflow de GitHub Actions real para el proyecto exportado.
 *
 * ENCONTRADO al auditar: los prompts del Frontend/Backend Engineer no
 * fuerzan ningún conjunto fijo de scripts en package.json (confirmado con
 * grep — el modelo decide libremente "build"/"lint"/"test" en cada
 * generación). Un workflow de CI que asuma `npm run lint` o `npm test` sin
 * comprobar que existen FALLARÍA SIEMPRE en cualquier proyecto que no los
 * tenga — el peor resultado posible para algo pensado para dar confianza.
 *
 * Por eso este workflow no asume nada: detecta en runtime, leyendo el
 * package.json real del repo recién subido, qué scripts existen, y solo
 * incluye los pasos correspondientes. Esto es exactamente cómo se construyen
 * los workflows de CI de calidad profesional — comprobar, no asumir.
 */
function generateCIWorkflowYAML(scripts: Record<string, string>): string {
  const steps: string[] = [
    "      - name: Checkout código\n        uses: actions/checkout@v4",
    "      - name: Configurar Node.js\n        uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n          cache: 'npm'",
    "      - name: Instalar dependencias\n        run: npm install",
  ];
  // Orden deliberado: typecheck antes que lint antes que test antes que
  // build — falla rápido en el paso más barato primero (mejor experiencia
  // de depuración que esperar un build completo para descubrir un error de
  // tipos trivial).
  if (scripts.typecheck) steps.push("      - name: Comprobar tipos\n        run: npm run typecheck");
  if (scripts.lint) steps.push("      - name: Lint\n        run: npm run lint");
  if (scripts.test) steps.push("      - name: Tests\n        run: npm test");
  if (scripts.build) steps.push("      - name: Build\n        run: npm run build");

  return `name: CI

# Generado automáticamente por Maris AI al exportar este proyecto.
# Se ejecuta en cada push y en cada Pull Request hacia main — solo incluye
# los pasos cuyo script existe realmente en package.json de este proyecto.
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
${steps.join("\n")}
`;
}

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "https://www.marisai.es";
// El callback de GitHub OAuth usa www.marisai.es por defecto (proxy Vercel → Railway).
// api.marisai.es aún no tiene certificado TLS válido (Railway pendiente del registro TXT DNS).
// Cuando api.marisai.es tenga TLS, configurar en Railway: GITHUB_CALLBACK_BASE_URL=https://api.marisai.es
const DEFAULT_CALLBACK_BASE = "https://www.marisai.es";
const configuredCallbackBase = process.env.GITHUB_CALLBACK_BASE_URL || process.env.PUBLIC_API_URL || process.env.API_URL || DEFAULT_CALLBACK_BASE;
const GITHUB_CALLBACK_URL = `${configuredCallbackBase.replace(/\/$/, "")}/api/github/callback`;

function safeReturnTo(raw?: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw.slice(0, 300);
}

function buildGitHubAuthorizeUrl(userId: string, returnTo?: string): string {
  const state = Buffer.from(JSON.stringify({ userId, ts: Date.now(), returnTo: safeReturnTo(returnTo) })).toString("base64url");
  const scope = "repo,read:user,user:email";
  return `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_CALLBACK_URL)}&scope=${encodeURIComponent(scope)}&state=${state}`;
}

// ─── Paso 1A: URL OAuth para frontends con Bearer token (Clerk) ───────────────
router.get("/github/connect-url", requireAuth, (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(500).json({ error: "GITHUB_CLIENT_ID no está configurado" });
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/dashboard";
  return res.json({ url: buildGitHubAuthorizeUrl(req.userId!, returnTo) });
});

// ─── Paso 1B: compatibilidad: redirigir a GitHub OAuth ───────────────────────
router.get("/github/connect", requireAuth, (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(500).send("GITHUB_CLIENT_ID no está configurado");
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/dashboard";
  return res.redirect(buildGitHubAuthorizeUrl(req.userId!, returnTo));
});

// ─── Paso 2: Callback de GitHub OAuth ────────────────────────────────────────
router.get("/github/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    logger.warn({ error }, "GitHub OAuth denegado por el usuario");
    return res.redirect(`${APP_URL}/dashboard?github_error=denied`);
  }

  if (!code || !state) {
    return res.redirect(`${APP_URL}/dashboard?github_error=invalid`);
  }

  let userId: string;
  let returnTo = "/dashboard";
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    userId = decoded.userId;
    returnTo = safeReturnTo(decoded.returnTo);
    if (!userId) throw new Error("userId vacío");
    // Verificar que el state no tiene más de 10 minutos
    if (Date.now() - decoded.ts > 10 * 60 * 1000) {
      return res.redirect(`${APP_URL}${returnTo}?github_error=expired`);
    }
  } catch {
    return res.redirect(`${APP_URL}/dashboard?github_error=invalid_state`);
  }

  try {
    // Intercambiar code por access_token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: GITHUB_CALLBACK_URL }),
    });
    const tokenData = (await tokenRes.json()) as any;

    if (tokenData.error || !tokenData.access_token) {
      logger.error({ tokenData }, "Error al obtener access_token de GitHub");
      return res.redirect(`${APP_URL}/dashboard?github_error=token_failed`);
    }

    const accessToken: string = tokenData.access_token;

    // Obtener info del usuario de GitHub
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    const githubUser = (await userRes.json()) as any;

    await connectDB();
    await User.findByIdAndUpdate(userId, {
      githubAccessToken: accessToken,
      githubLogin: githubUser.login,
      githubId: String(githubUser.id),
      githubAvatarUrl: githubUser.avatar_url,
      githubConnectedAt: new Date(),
    });

    logger.info({ userId, githubLogin: githubUser.login }, "GitHub conectado correctamente");
    res.redirect(`${APP_URL}${returnTo}?github_connected=1`);
  } catch (err) {
    logger.error({ err }, "Error en GitHub OAuth callback");
    res.redirect(`${APP_URL}${returnTo}?github_error=server_error`);
  }
});

// ─── Estado de conexión ───────────────────────────────────────────────────────
router.get("/github/status", requireAuth, async (req, res) => {
  try {
    await connectDB();
    const u = req.dbUser!;
    if (u.githubAccessToken && u.githubLogin) {
      res.json({ connected: true, login: u.githubLogin, avatarUrl: u.githubAvatarUrl ?? null, connectedAt: u.githubConnectedAt ?? null });
    } else {
      res.json({ connected: false });
    }
  } catch (err) {
    logger.error({ err }, "GET /github/status error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Desconectar GitHub ───────────────────────────────────────────────────────
router.delete("/github/disconnect", requireAuth, async (req, res) => {
  try {
    await connectDB();
    await User.findByIdAndUpdate(req.userId!, {
      $unset: { githubAccessToken: "", githubLogin: "", githubId: "", githubAvatarUrl: "", githubConnectedAt: "" },
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /github/disconnect error");
    res.status(500).json({ error: "Error interno" });
  }
});

// ─── Subir proyecto a GitHub ──────────────────────────────────────────────────
// Exportado como función nombrada (en vez de solo el callback inline de
// router.post) para que deployment.ts pueda reutilizar exactamente esta
// misma lógica desde /api/apps/:appId/github — antes esa ruta era un mock
// que nunca llamaba a este código real (ver comentario en deployment.ts).
export async function githubPushHandler(req: Request, res: Response) {
  const { appId } = req.params;
  const { repoName, isPrivate = true, description = "" } = req.body as { repoName?: string; isPrivate?: boolean; description?: string };

  try {
    await connectDB();
    const u = req.dbUser!;

    if (!u.githubAccessToken || !u.githubLogin) {
      return res.status(401).json({ error: "GitHub no está conectado. Conecta tu cuenta primero." });
    }

    const app = await GeneratedApp.findOne({ _id: appId, userId: req.userId! }).lean();
    if (!app) {
      return res.status(404).json({ error: "Aplicación no encontrada" });
    }

    const finalRepoName = repoName ?? app.title.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 100);
    const token = u.githubAccessToken;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    // 1. Crear repositorio (o verificar que ya existe)
    let repoFullName: string;
    let repoUrl: string;

    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: finalRepoName, description: description || app.description, private: isPrivate, auto_init: false }),
    });
    const createData = (await createRes.json()) as any;

    if (createRes.status === 422 && createData.errors?.[0]?.message?.includes("already exists")) {
      // El repo ya existe, usarlo
      // IMPORTANTE: Aseguramos que el repoFullName use el login del usuario actual
      // para evitar colisiones con repositorios de otros usuarios con el mismo nombre.
      repoFullName = `${u.githubLogin}/${finalRepoName}`;
      repoUrl = `https://github.com/${repoFullName}`;
    } else if (!createRes.ok) {
      logger.error({ createData }, "Error al crear repo en GitHub");
      return res.status(500).json({ error: `Error al crear repositorio: ${createData.message ?? "desconocido"}` });
    } else {
      repoFullName = createData.full_name;
      repoUrl = createData.html_url;
    }

    // 2. Parsear el bundle de archivos
    const { parseBundleToVFS } = await import("../lib/validate");
    const files = parseBundleToVFS(app.frontendCode);

    if (!files || Object.keys(files).length === 0) {
      return res.status(400).json({ error: "El proyecto no tiene código para subir" });
    }

    // 3. Crear árbol de archivos en GitHub (usando Git Trees API para eficiencia)
    // Primero obtener el SHA del commit actual (si el repo ya tiene commits)
    let baseSha: string | undefined;
    let baseTreeSha: string | undefined;

    const refRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/ref/heads/main`, { headers });
    if (refRes.ok) {
      const refData = (await refRes.json()) as any;
      baseSha = refData.object?.sha;
      if (baseSha) {
        const commitRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits/${baseSha}`, { headers });
        const commitData = (await commitRes.json()) as any;
        baseTreeSha = commitData.tree?.sha;
      }
    }

    // Crear blobs para cada archivo
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];

    for (const [filePath, content] of Object.entries(files)) {
      const blobRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: Buffer.from(content as string, "utf8").toString("base64"), encoding: "base64" }),
      });
      if (!blobRes.ok) continue;
      const blobData = (await blobRes.json()) as any;
      treeItems.push({ path: filePath.replace(/^\//, ""), mode: "100644", type: "blob", sha: blobData.sha });
    }

    // Añadir README.md
    const readmeContent = `# ${app.title}\n\n${app.description}\n\n> Generado con [Maris AI](https://www.marisai.es)\n`;
    const readmeBlobRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: Buffer.from(readmeContent, "utf8").toString("base64"), encoding: "base64" }),
    });
    if (readmeBlobRes.ok) {
      const readmeBlobData = (await readmeBlobRes.json()) as any;
      treeItems.push({ path: "README.md", mode: "100644", type: "blob", sha: readmeBlobData.sha });
    }

    // Añadir .github/workflows/ci.yml — detecta los scripts reales del
    // package.json de este proyecto concreto (puede haber varios, ej.
    // frontend y backend en carpetas distintas en proyectos de
    // microservicios) y genera un workflow que solo ejecuta lo que
    // realmente existe, para que el primer push del usuario a GitHub
    // muestre un check ✅ real, no un ❌ por un script inexistente.
    try {
      const packageJsonEntry = Object.entries(files).find(([path]) => path.replace(/^\//, "") === "package.json");
      const scripts: Record<string, string> = packageJsonEntry
        ? (JSON.parse(packageJsonEntry[1] as string)?.scripts ?? {})
        : {};
      const ciYaml = generateCIWorkflowYAML(scripts);
      const ciBlobRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/blobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: Buffer.from(ciYaml, "utf8").toString("base64"), encoding: "base64" }),
      });
      if (ciBlobRes.ok) {
        const ciBlobData = (await ciBlobRes.json()) as any;
        treeItems.push({ path: ".github/workflows/ci.yml", mode: "100644", type: "blob", sha: ciBlobData.sha });
      }
    } catch (ciErr) {
      // Un error al generar el CI (ej. package.json mal formado) no debe
      // bloquear el push del código en sí — es una mejora añadida, no un
      // requisito del export.
      logger.warn({ ciErr }, "No se pudo generar .github/workflows/ci.yml — continuando sin él");
    }

    // Crear tree
    const treeBody: any = { tree: treeItems };
    if (baseTreeSha) treeBody.base_tree = baseTreeSha;

    const treeRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees`, {
      method: "POST",
      headers,
      body: JSON.stringify(treeBody),
    });
    if (!treeRes.ok) {
      const treeErr = (await treeRes.json()) as any;
      return res.status(500).json({ error: `Error al crear árbol: ${treeErr.message ?? "desconocido"}` });
    }
    const treeData = (await treeRes.json()) as any;

    // Crear commit
    const commitBody: any = {
      message: `feat: proyecto generado con Maris AI\n\n${app.description}`,
      tree: treeData.sha,
      author: { name: "Maris AI", email: "noreply@marisai.es", date: new Date().toISOString() },
    };
    if (baseSha) commitBody.parents = [baseSha];

    const commitRes2 = await fetch(`https://api.github.com/repos/${repoFullName}/git/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify(commitBody),
    });
    if (!commitRes2.ok) {
      const commitErr = (await commitRes2.json()) as any;
      return res.status(500).json({ error: `Error al crear commit: ${commitErr.message ?? "desconocido"}` });
    }
    const commitData2 = (await commitRes2.json()) as any;

    // Actualizar referencia main (o crearla)
    const updateRefRes = await fetch(`https://api.github.com/repos/${repoFullName}/git/refs/heads/main`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sha: commitData2.sha, force: true }),
    });

    if (!updateRefRes.ok) {
      // Crear la ref si no existe
      await fetch(`https://api.github.com/repos/${repoFullName}/git/refs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ref: "refs/heads/main", sha: commitData2.sha }),
      });
    }

    // 4. Guardar la URL del repo en la app
    await GeneratedApp.findByIdAndUpdate(appId, { githubRepoUrl: repoUrl, githubRepoFullName: repoFullName });

    logger.info({ userId: req.userId!, appId, repoFullName }, "Proyecto subido a GitHub correctamente");
    return res.json({ ok: true, repoUrl, repoFullName });
  } catch (err) {
    logger.error({ err }, "POST /github/push error");
    return res.status(500).json({ error: "Error interno al subir el proyecto a GitHub" });
  }
}

router.post("/github/push/:appId", requireAuth, githubPushHandler);

export default router;
