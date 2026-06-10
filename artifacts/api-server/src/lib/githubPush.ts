/**
 * githubPush.ts — Exportación de proyectos al GitHub del CLIENTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Cada usuario usa su propio token OAuth (githubAccessToken guardado en MongoDB
 * tras el flujo /api/github/connect → /api/github/callback).
 *
 * El GITHUB_TOKEN del servidor solo se usa como fallback para operaciones admin.
 * Si el usuario no ha conectado su GitHub, se lanza un error claro con instrucciones.
 */
import { Octokit } from "@octokit/rest";
import { bundleToFiles } from "./exportZip";

/**
 * Obtiene el Octokit autenticado con el token del usuario.
 * Prioridad: token OAuth del usuario > GITHUB_TOKEN del servidor (solo admin).
 */
const getOctokit = (userToken?: string | null) => {
  const token = userToken || process.env.GITHUB_TOKEN || process.env.MARIS_AI_GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "No hay token de GitHub disponible. Conecta tu cuenta de GitHub en Maris AI " +
      "haciendo clic en el botón GitHub del proyecto para exportarlo a tu repositorio personal."
    );
  }
  return new Octokit({ auth: token });
};

interface GhUser {
  login: string;
}

interface GhRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
}

interface GhRef {
  object: { sha: string };
}

interface GhCommit {
  sha: string;
  tree: { sha: string };
}

interface GhTreeNode {
  sha: string;
}

type GhResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; message: string };

async function ghRaw<T>(
  path: string,
  init: { method?: string; body?: any } = {},
  userToken?: string | null,
): Promise<GhResult<T>> {
  const octokit = getOctokit(userToken);
  try {
    const method = (init.method ?? "GET").toUpperCase();
    const response = await octokit.request(`${method} ${path}`, init.body || {});
    return { ok: true, data: response.data as T, status: response.status };
  } catch (error: any) {
    return {
      ok: false,
      status: error.status || 500,
      message: error.message || "Error en la petición a GitHub",
    };
  }
}

async function gh<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  userToken?: string | null,
): Promise<T> {
  const r = await ghRaw<T>(path, init, userToken);
  if (!r.ok) {
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${path} → HTTP ${r.status}${r.message ? `: ${r.message}` : ""}`,
    );
  }
  return r.data;
}

/**
 * Slugify an arbitrary title into a GitHub-safe repo name.
 */
function repoNameFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "maris-app";
}

/**
 * Build the file map (frontend/* + README.md + .gitignore).
 */
function buildFileMap(opts: {
  title: string;
  description: string;
  frontendBundle: string;
}): Record<string, string> {
  const files: Record<string, string> = {};
  const frontendFiles = bundleToFiles(opts.frontendBundle);
  for (const [p, contents] of Object.entries(frontendFiles)) {
    files[`frontend/${p}`] = contents;
  }
  files["README.md"] =
    `# ${opts.title}\n\n${opts.description}\n\n` +
    `Generado y mantenido automáticamente por **[Maris AI](https://www.marisai.es)**. ` +
    `Cada vez que actualizas la app desde Maris AI, este repo recibe un ` +
    `commit nuevo en \`main\` con la versión actual del frontend.\n\n` +
    `## Estructura\n\n` +
    `- \`frontend/\` — React + Vite + Tailwind\n` +
    `\n## Cómo correrlo en local\n\n` +
    `\`\`\`bash\ncd frontend\nnpm install\nnpm run dev\n\`\`\`\n`;
  files[".gitignore"] =
    `node_modules/\ndist/\nbuild/\n.next/\n.vercel/\n.env\n.env.local\n.DS_Store\n`;
  return files;
}

/**
 * Push the app to GitHub using the CLIENT's OAuth token.
 *
 * @param opts.userGitHubToken - Token OAuth del usuario (de User.githubAccessToken en MongoDB).
 *                               Si no se proporciona, se usa el GITHUB_TOKEN del servidor (solo admin).
 */
export async function pushAppToGitHub(opts: {
  title: string;
  description: string;
  frontendBundle: string;
  backendBundle?: string;
  /** Persisted from the last successful push. Null on first push. */
  existingRepoFullName?: string | null;
  /** Token OAuth del usuario (de User.githubAccessToken). */
  userGitHubToken?: string | null;
  /** Si true, el repo se crea como privado. */
  isPrivate?: boolean;
  /** Nombre personalizado del repo (opcional, se deriva del título si no se da). */
  repoName?: string;
}): Promise<{ url: string; repoFullName: string; updated: boolean }> {
  const token = opts.userGitHubToken || null;
  const user = await gh<GhUser>("/user", {}, token);
  const owner = user.login;

  const files = buildFileMap(opts);
  if (Object.keys(files).length === 0) {
    throw new Error("La app no tiene archivos que subir.");
  }

  let reusedExisting = false;
  let repo: GhRepo | null = null;

  if (opts.existingRepoFullName) {
    const found = await ghRaw<GhRepo>(`/repos/${opts.existingRepoFullName}`, {}, token);
    if (found.ok) {
      repo = found.data;
      reusedExisting = true;
    } else if (found.status !== 404) {
      throw new Error(
        `GitHub GET /repos/${opts.existingRepoFullName} → HTTP ${found.status}${found.message ? `: ${found.message}` : ""}`,
      );
    }
  }

  if (!repo) {
    const desiredSlug = opts.repoName
      ? opts.repoName.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90)
      : (opts.existingRepoFullName?.split("/")[1] ?? repoNameFromTitle(opts.title));

    repo = await createFreshRepo({
      owner,
      desiredSlug,
      description: opts.description,
      isPrivate: opts.isPrivate ?? false,
      token,
    });
  }

  const repoName = repo.full_name.split("/")[1];
  const branch = repo.default_branch || "main";

  const ref = await gh<GhRef>(
    `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
    {},
    token,
  );
  const baseCommit = await gh<GhCommit>(
    `/repos/${owner}/${repoName}/git/commits/${ref.object.sha}`,
    {},
    token,
  );
  void baseCommit; // used for type safety

  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  for (const [p, contents] of Object.entries(files)) {
    const blob = await gh<GhTreeNode>(
      `/repos/${owner}/${repoName}/git/blobs`,
      {
        method: "POST",
        body: {
          content: Buffer.from(contents, "utf-8").toString("base64"),
          encoding: "base64",
        },
      },
      token,
    );
    tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = await gh<GhTreeNode>(
    `/repos/${owner}/${repoName}/git/trees`,
    { method: "POST", body: { tree } },
    token,
  );

  const commitMessage = reusedExisting
    ? `Maris AI update: ${opts.title} — ${new Date().toISOString().slice(0, 19).replace("T", " ")}`
    : `Initial Maris AI export: ${opts.title}`;

  const newCommit = await gh<GhCommit>(
    `/repos/${owner}/${repoName}/git/commits`,
    {
      method: "POST",
      body: {
        message: commitMessage,
        tree: newTree.sha,
        parents: [ref.object.sha],
      },
    },
    token,
  );

  const refPath = `/repos/${owner}/${repoName}/git/refs/heads/${branch}`;
  let commitToPush = newCommit;
  let attempt = 0;

  while (true) {
    const patch = await ghRaw<unknown>(refPath, {
      method: "PATCH",
      body: { sha: commitToPush.sha, force: false },
    }, token);
    if (patch.ok) break;
    const isFastFwdConflict =
      patch.status === 422 &&
      /not a fast forward|update is not a fast forward/i.test(patch.message ?? "");
    if (!isFastFwdConflict || attempt >= 4) {
      throw new Error(
        `GitHub PATCH ${refPath} → HTTP ${patch.status}${patch.message ? `: ${patch.message}` : ""}`,
      );
    }
    attempt += 1;
    const freshRef = await gh<GhRef>(
      `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
      {},
      token,
    );
    commitToPush = await gh<GhCommit>(
      `/repos/${owner}/${repoName}/git/commits`,
      {
        method: "POST",
        body: {
          message: commitMessage,
          tree: newTree.sha,
          parents: [freshRef.object.sha],
        },
      },
      token,
    );
  }

  return {
    url: repo.html_url,
    repoFullName: repo.full_name,
    updated: reusedExisting,
  };
}

/**
 * Create a brand-new repo with the desired slug.
 */
async function createFreshRepo(opts: {
  owner: string;
  desiredSlug: string;
  description: string;
  isPrivate?: boolean;
  token?: string | null;
}): Promise<GhRepo> {
  const baseSlug = opts.desiredSlug.slice(0, 90) || "maris-app";
  for (let attempt = 1; attempt <= 10; attempt++) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const created = await ghRaw<GhRepo>("/user/repos", {
      method: "POST",
      body: {
        name: candidate,
        description: opts.description.slice(0, 350),
        private: opts.isPrivate ?? false,
        auto_init: true,
      },
    }, opts.token);
    if (created.ok) return created.data;
    if (created.status === 422 && /already exists/i.test(created.message)) {
      continue;
    }
    throw new Error(
      `GitHub POST /user/repos → HTTP ${created.status}${created.message ? `: ${created.message}` : ""}`,
    );
  }
  throw new Error(
    `No pude crear el repo: ya existen ${baseSlug}, ${baseSlug}-2, … hasta -10 en tu cuenta.`,
  );
}
