import { ReplitConnectors } from "@replit/connectors-sdk";
import { bundleToFiles } from "./exportZip";

// GitHub blueprint integration — uses Replit's connector proxy to make
// authenticated requests with the workspace owner's GitHub token (read:org,
// read:project, read:user, repo, user:email scopes). For a multi-user SaaS
// each end-user would need their own OAuth flow; this MVP scopes pushes to
// the workspace owner's account, which is fine for personal use.

const connectors = new ReplitConnectors();

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

async function gh<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
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
    throw new Error(
      `GitHub ${init.method ?? "GET"} ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Slugify an arbitrary title into a GitHub-safe repo name. Repo names are
 * limited to alphanumerics + hyphens + underscores + periods, 100 chars max.
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
  const safe = base || "appforge-app";
  // Append a short random suffix to avoid collisions on repeated push.
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${safe}-${suffix}`;
}

/**
 * Create a brand-new GitHub repo under the authenticated user's account and
 * push every file in the frontend (and backend, if present) bundles into a
 * single initial commit on the default branch.
 *
 * Returns the public html_url of the new repository.
 */
export async function pushAppToGitHub(opts: {
  title: string;
  description: string;
  frontendBundle: string;
  backendBundle: string;
}): Promise<{ url: string; repoFullName: string }> {
  // 1. Resolve the authenticated user (we'll create the repo under them).
  const user = await gh<GhUser>("/user");

  // 2. Build the file map (frontend/* + optional backend/* + README.md).
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
    `Generado con AppForge. Estructura: \`frontend/\` (React + Vite + Tailwind)` +
    `${hasBackend ? `, \`backend/\` (Node + Express).` : "."}\n`;

  if (Object.keys(files).length === 0) {
    throw new Error("La app no tiene archivos que subir.");
  }

  // 3. Create the repo. auto_init creates an initial commit so we have a
  //    branch + commit SHA to build on top of.
  const repoName = repoNameFromTitle(opts.title);
  const repo = await gh<GhRepo>("/user/repos", {
    method: "POST",
    body: {
      name: repoName,
      description: opts.description.slice(0, 350),
      private: false,
      auto_init: true,
    },
  });

  const owner = user.login;
  const branch = repo.default_branch || "main";

  // 4. Get the current branch ref → commit → tree so we can extend it.
  const ref = await gh<GhRef>(
    `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
  );
  const baseCommit = await gh<GhCommit>(
    `/repos/${owner}/${repoName}/git/commits/${ref.object.sha}`,
  );

  // 5. Create blobs for every file (base64 to be binary-safe, though our files
  //    are all text). Sequential to stay well under GitHub's secondary rate
  //    limit (currently ~80 concurrent writes per minute).
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
    );
    tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 6. Build the new tree on top of the auto-init commit's tree.
  const newTree = await gh<GhTreeNode>(
    `/repos/${owner}/${repoName}/git/trees`,
    {
      method: "POST",
      body: { base_tree: baseCommit.tree.sha, tree },
    },
  );

  // 7. Create the commit pointing at our new tree.
  const newCommit = await gh<GhCommit>(
    `/repos/${owner}/${repoName}/git/commits`,
    {
      method: "POST",
      body: {
        message: `Initial AppForge export: ${opts.title}`,
        tree: newTree.sha,
        parents: [ref.object.sha],
      },
    },
  );

  // 8. Fast-forward the branch.
  await gh(`/repos/${owner}/${repoName}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: { sha: newCommit.sha, force: false },
  });

  return { url: repo.html_url, repoFullName: repo.full_name };
}
