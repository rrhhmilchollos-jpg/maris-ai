import { Maris AIConnectors } from "@maris-ai/connectors-sdk";
import { bundleToFiles } from "./exportZip";

// GitHub blueprint integration — uses Maris AI's connector proxy to make
// authenticated requests with the workspace owner's GitHub token (read:org,
// read:project, read:user, repo, user:email scopes). For a multi-user SaaS
// each end-user would need their own OAuth flow; this MVP scopes pushes to
// the workspace owner's account, which is fine for personal use.

const connectors = new Maris AIConnectors();

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
  init: { method?: string; body?: unknown } = {},
): Promise<GhResult<T>> {
  const res = await connectors.proxy("github", path, {
    method: init.method ?? "GET",
    headers: init.body
      ? { "content-type": "application/json", accept: "application/vnd.github+json" }
      : { accept: "application/vnd.github+json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string };
      detail = j.message ?? "";
    } catch {
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
    }
    return { ok: false, status: res.status, message: detail };
  }
  // 204 No Content (e.g. DELETE) has no body — caller does not need data.
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = undefined as unknown as T;
  }
  return { ok: true, data, status: res.status };
}

async function gh<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const r = await ghRaw<T>(path, init);
  if (!r.ok) {
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${path} → HTTP ${r.status}${r.message ? `: ${r.message}` : ""}`,
    );
  }
  return r.data;
}

/**
 * Slugify an arbitrary title into a GitHub-safe repo name. Repo names are
 * limited to alphanumerics + hyphens + underscores + periods, 100 chars max.
 *
 * Stable: NO random suffix here. We want repeated pushes for the same app to
 * keep targeting the same repo. Collision handling (when another repo with
 * the same name already exists in the user's account) is done by the caller
 * with an incremental "-2", "-3" suffix.
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
 * Build the file map (frontend/* + optional backend/* + README.md + a
 * top-level .gitignore that keeps node_modules and Vercel build artefacts
 * out of the repo). Returned shape is deterministic: same app contents →
 * same file list. This lets a re-push produce a clean snapshot tree (no
 * stale leftovers from previous pushes).
 */
function buildFileMap(opts: {
  title: string;
  description: string;
  frontendBundle: string;
  backendBundle: string;
}): Record<string, string> {
  const files: Record<string, string> = {};
  const frontendFiles = bundleToFiles(opts.frontendBundle);
  for (const [p, contents] of Object.entries(frontendFiles)) {
    files[`frontend/${p}`] = contents;
  }
  const hasBackend =
    opts.backendBundle &&
    !/^no backend required/i.test(opts.backendBundle.trim());
  if (hasBackend) {
    const backendFiles = bundleToFiles(opts.backendBundle);
    for (const [p, contents] of Object.entries(backendFiles)) {
      files[`backend/${p}`] = contents;
    }
  }
  files["README.md"] =
    `# ${opts.title}\n\n${opts.description}\n\n` +
    `Generado y mantenido automáticamente por **Maris AI**. ` +
    `Cada vez que actualizas la app desde Maris AI, este repo recibe un ` +
    `commit nuevo en \`main\` con la versión actual del código.\n\n` +
    `## Estructura\n\n` +
    `- \`frontend/\` — React + Vite + Tailwind\n` +
    `${hasBackend ? `- \`backend/\` — Node + Express\n` : ""}` +
    `\n## Cómo correrlo en local\n\n` +
    `\`\`\`bash\ncd frontend\nnpm install\nnpm run dev\n\`\`\`\n`;
  files[".gitignore"] =
    `node_modules/\ndist/\nbuild/\n.next/\n.vercel/\n.env\n.env.local\n.DS_Store\n`;
  return files;
}

/**
 * Push the app to GitHub. Idempotent: if `existingRepoFullName` is given AND
 * the repo still exists, we add a NEW commit to the same `main` branch
 * (replacing the file tree with the current snapshot, which deletes obsolete
 * files). Otherwise we create a fresh repo with a stable slug derived from
 * the title (no random suffix), bumping `-2`, `-3`, … if a repo with that
 * exact name already exists in the authenticated user's account.
 *
 * Caller is responsible for persisting `repoFullName` so the next push hits
 * the same repo. We always return both the URL and the full_name.
 */
export async function pushAppToGitHub(opts: {
  title: string;
  description: string;
  frontendBundle: string;
  backendBundle: string;
  /** Persisted from the last successful push. Null on first push. */
  existingRepoFullName?: string | null;
}): Promise<{ url: string; repoFullName: string; updated: boolean }> {
  const user = await gh<GhUser>("/user");
  const owner = user.login;

  const files = buildFileMap(opts);
  if (Object.keys(files).length === 0) {
    throw new Error("La app no tiene archivos que subir.");
  }

  // 1. Resolve the target repo. Three paths:
  //    a) caller passed an existing full_name and the repo still exists
  //       on GitHub → reuse it (update path).
  //    b) caller passed an existing full_name but the repo is gone (404)
  //       → fall through to fresh-create with the SAME slug (so the user
  //       gets back a repo with the expected name even after deleting it).
  //    c) no existing full_name → fresh-create with a stable slug.
  // `reusedExisting` tracks whether we ended up COMMITTING into a pre-existing
  // repo. It must be set AFTER repo resolution (not derived from the input
  // arg) because the "repo was deleted on GitHub → recreate fresh" path
  // means we did not actually update anything — the user sees a brand-new
  // commit history. Returning `updated: true` in that case would mislead
  // both the toast copy and any caller that branches on it.
  let reusedExisting = false;
  let repo: GhRepo | null = null;
  if (opts.existingRepoFullName) {
    const found = await ghRaw<GhRepo>(`/repos/${opts.existingRepoFullName}`);
    if (found.ok) {
      repo = found.data;
      reusedExisting = true;
    } else if (found.status !== 404) {
      // 401, 403, 5xx — surface as a real error rather than silently
      // falling back to "create new repo", which would hide auth issues
      // behind an unexpected fresh repo appearing in the user's account.
      throw new Error(
        `GitHub GET /repos/${opts.existingRepoFullName} → HTTP ${found.status}${found.message ? `: ${found.message}` : ""}`,
      );
    }
  }

  if (!repo) {
    repo = await createFreshRepo({
      owner,
      desiredSlug:
        opts.existingRepoFullName?.split("/")[1] ??
        repoNameFromTitle(opts.title),
      description: opts.description,
    });
  }

  const repoName = repo.full_name.split("/")[1];
  const branch = repo.default_branch || "main";

  // 2. Resolve the current branch HEAD. On a fresh `auto_init` repo this is
  //    the auto-init commit. On an existing repo it's whatever the last
  //    push left.
  const ref = await gh<GhRef>(
    `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
  );
  const baseCommit = await gh<GhCommit>(
    `/repos/${owner}/${repoName}/git/commits/${ref.object.sha}`,
  );

  // 3. Create blobs for every file in the new snapshot. Sequential to stay
  //    well under GitHub's secondary rate limit (~80 concurrent writes/min).
  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] =
    [];
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
    );
    tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 4. Build a tree WITHOUT base_tree so the new commit's tree contains
  //    exactly the current snapshot — files removed from Maris AI between
  //    pushes are also removed from `main` (otherwise GitHub merges with
  //    the previous tree and old files linger forever).
  const newTree = await gh<GhTreeNode>(
    `/repos/${owner}/${repoName}/git/trees`,
    { method: "POST", body: { tree } },
  );

  // 5. Commit pointing at the new tree, parented on the previous HEAD so
  //    the history is preserved (you can still see every Maris AI update
  //    as a separate commit on `main`).
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
  );

  // 6. Fast-forward the branch. force=false → fails if the branch moved
  //    underneath us (e.g. user double-clicked "Actualizar" or pushed
  //    manually). When that happens, the safe fix is NOT to force-push
  //    (would silently overwrite user commits) but to re-read HEAD,
  //    re-parent our commit on top, and PATCH again. Bounded retries
  //    cap the cost; if we still race after a few rounds, surface the
  //    error so the user can retry from the UI.
  const refPath = `/repos/${owner}/${repoName}/git/refs/heads/${branch}`;
  let commitToPush = newCommit;
  let attempt = 0;
  // 5 attempts ≈ 5 lost races, far more than any realistic double-click.
  // We catch ONLY the conflict case; auth/network errors propagate.
  while (true) {
    const patch = await ghRaw<unknown>(refPath, {
      method: "PATCH",
      body: { sha: commitToPush.sha, force: false },
    });
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
    // Re-read HEAD and re-create the commit with the new parent. Tree is
    // unchanged (it's a snapshot of the user's current bundle), so we
    // only re-do the commit object.
    const freshRef = await gh<GhRef>(
      `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
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
    );
  }

  return {
    url: repo.html_url,
    repoFullName: repo.full_name,
    updated: reusedExisting,
  };
}

/**
 * Create a brand-new repo with the desired slug, retrying with `-2`, `-3`,
 * … if a repo with that exact name already exists in the user's account.
 * Caps at 10 attempts so we never spin forever on a misconfigured account.
 */
async function createFreshRepo(opts: {
  owner: string;
  desiredSlug: string;
  description: string;
}): Promise<GhRepo> {
  const baseSlug = opts.desiredSlug.slice(0, 90) || "maris-app";
  for (let attempt = 1; attempt <= 10; attempt++) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const created = await ghRaw<GhRepo>("/user/repos", {
      method: "POST",
      body: {
        name: candidate,
        description: opts.description.slice(0, 350),
        private: false,
        auto_init: true,
      },
    });
    if (created.ok) return created.data;
    // 422 with "name already exists" → try the next suffix. Anything else
    // (auth, rate limit, server) is a real error and should surface.
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
