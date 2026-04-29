import archiver from "archiver";
import type { Response } from "express";

const FILE_MARKER = /\/\/\s*===\s*FILE:\s*(.+?)\s*===/g;

/**
 * Parse the '// === FILE: <path> ===' bundle into a flat { path: contents } map.
 * Identical contract to the validator / Sandpack parser, but kept independent
 * so a future change there does not silently mutate the export format.
 */
export function bundleToFiles(bundle: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!bundle) return out;
  const matches: { path: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  FILE_MARKER.lastIndex = 0;
  while ((m = FILE_MARKER.exec(bundle)) !== null) {
    matches.push({ path: m[1].trim(), index: m.index + m[0].length });
  }
  if (matches.length === 0) return out;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length
      ? bundle.lastIndexOf("// === FILE:", matches[i + 1].index)
      : bundle.length;
    const safeEnd = end > start ? end : bundle.length;
    let p = matches[i].path;
    // Drop any leading "./" or "/" so the archive does not contain absolute paths.
    if (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.slice(1);
    // Defensive against path traversal in generated paths.
    if (p.includes("..")) continue;
    out[p] = bundle.slice(start, safeEnd).replace(/^\n+/, "").trimEnd() + "\n";
  }
  return out;
}

/**
 * Stream a ZIP of the user's app to the HTTP response. The archive contains a
 * frontend/ subtree, an optional backend/ subtree, and a top-level README.md
 * describing how to run the project locally.
 *
 * Errors are surfaced via the optional onError callback; the caller is
 * responsible for ending the response if the headers haven't been sent yet.
 */
export function streamAppZip(
  res: Response,
  opts: {
    title: string;
    description: string;
    frontendBundle: string;
    backendBundle: string;
    onError?: (err: Error) => void;
  },
): void {
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("warning", (err) => {
    // ENOENT is benign — non-existent files are simply skipped.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      opts.onError?.(err);
    }
  });
  archive.on("error", (err) => {
    opts.onError?.(err);
  });

  archive.pipe(res);

  const frontendFiles = bundleToFiles(opts.frontendBundle);
  for (const [p, contents] of Object.entries(frontendFiles)) {
    archive.append(contents, { name: `frontend/${p}` });
  }

  const hasBackend =
    opts.backendBundle &&
    !/^no backend required/i.test(opts.backendBundle.trim());
  if (hasBackend) {
    const backendFiles = bundleToFiles(opts.backendBundle);
    if (Object.keys(backendFiles).length > 0) {
      for (const [p, contents] of Object.entries(backendFiles)) {
        archive.append(contents, { name: `backend/${p}` });
      }
    } else {
      // Backend wasn't a structured bundle — store the raw text so it isn't lost.
      archive.append(opts.backendBundle, { name: "backend/README.txt" });
    }
  }

  const readme = `# ${opts.title}\n\n${opts.description}\n\n` +
    `Generado con Maris AI.\n\n` +
    `## Estructura\n\n` +
    `- \`frontend/\` — proyecto React + Vite + Tailwind. ` +
    `Entra y ejecuta \`pnpm install\` y \`pnpm dev\`.\n` +
    (hasBackend
      ? `- \`backend/\` — servidor Node + Express. ` +
        `Entra y ejecuta \`pnpm install\` y \`pnpm dev\`.\n`
      : "") +
    `\n## Notas\n\nEsta carpeta contiene el código tal y como lo generó la IA. ` +
    `Revisa los archivos antes de correrlos en producción.\n`;
  archive.append(readme, { name: "README.md" });

  archive.finalize();
}
