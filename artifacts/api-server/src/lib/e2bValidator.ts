import { Sandbox } from "e2b";
import { bundleToFiles } from "./exportZip";
import { logger } from "./logger";

const SANDBOX_TIMEOUT_MS = 5 * 60_000;
const INSTALL_TIMEOUT_MS = 3 * 60_000;
const BUILD_TIMEOUT_MS = 2 * 60_000;
const APP_DIR = "/home/user/app";

export interface E2BBuildResult {
  ok: boolean;
  ranInstall: boolean;
  ranBuild: boolean;
  durationMs: number;
  installStdout: string;
  installStderr: string;
  buildStdout: string;
  buildStderr: string;
  reason?: string;
  sandboxId?: string;
}

export function isE2BEnabled(): boolean {
  return Boolean(process.env.E2B_API_KEY);
}

/**
 * Spin up an E2B microVM, write the generated frontend bundle as files, run
 * `npm install && npm run build`, capture stdout+stderr and return a
 * structured result. Always destroys the sandbox at the end.
 *
 * Soft-fails when E2B is not configured (returns ok=false with reason).
 * Callers should treat this as best-effort: a failure here must NOT abort
 * the user's generation pipeline — it's a quality signal, not a gate.
 */
export async function validateBundleInE2B(opts: {
  bundle: string;
  log?: typeof logger;
}): Promise<E2BBuildResult> {
  const start = Date.now();
  const log = opts.log ?? logger;

  if (!isE2BEnabled()) {
    return {
      ok: false,
      ranInstall: false,
      ranBuild: false,
      durationMs: 0,
      installStdout: "",
      installStderr: "",
      buildStdout: "",
      buildStderr: "",
      reason: "E2B_API_KEY not set",
    };
  }

  const files = bundleToFiles(opts.bundle);
  const fileCount = Object.keys(files).length;
  if (fileCount === 0) {
    return {
      ok: false,
      ranInstall: false,
      ranBuild: false,
      durationMs: 0,
      installStdout: "",
      installStderr: "",
      buildStdout: "",
      buildStderr: "",
      reason: "empty bundle",
    };
  }
  if (!files["package.json"]) {
    return {
      ok: false,
      ranInstall: false,
      ranBuild: false,
      durationMs: 0,
      installStdout: "",
      installStderr: "",
      buildStdout: "",
      buildStderr: "",
      reason: "bundle has no package.json",
    };
  }

  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ timeoutMs: SANDBOX_TIMEOUT_MS });
    log.info(
      { sandboxId: sandbox.sandboxId, fileCount },
      "E2B sandbox created — uploading bundle",
    );

    const writeEntries = Object.entries(files).map(([path, data]) => ({
      path: `${APP_DIR}/${path}`,
      data,
    }));
    await sandbox.files.write(writeEntries);

    const install = await sandbox.commands.run(
      `cd ${APP_DIR} && npm install --no-audit --no-fund --prefer-offline --loglevel=error`,
      { timeoutMs: INSTALL_TIMEOUT_MS },
    );

    if (install.exitCode !== 0) {
      return {
        ok: false,
        ranInstall: true,
        ranBuild: false,
        durationMs: Date.now() - start,
        installStdout: install.stdout,
        installStderr: install.stderr,
        buildStdout: "",
        buildStderr: "",
        reason: "install_failed",
        sandboxId: sandbox.sandboxId,
      };
    }

    const build = await sandbox.commands.run(
      `cd ${APP_DIR} && npm run build`,
      { timeoutMs: BUILD_TIMEOUT_MS },
    );

    return {
      ok: build.exitCode === 0,
      ranInstall: true,
      ranBuild: true,
      durationMs: Date.now() - start,
      installStdout: install.stdout,
      installStderr: install.stderr,
      buildStdout: build.stdout,
      buildStderr: build.stderr,
      reason: build.exitCode === 0 ? undefined : "build_failed",
      sandboxId: sandbox.sandboxId,
    };
  } catch (err) {
    return {
      ok: false,
      ranInstall: false,
      ranBuild: false,
      durationMs: Date.now() - start,
      installStdout: "",
      installStderr: "",
      buildStdout: "",
      buildStderr: err instanceof Error ? err.message : String(err),
      reason: "exception",
      sandboxId: sandbox?.sandboxId,
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch (killErr) {
        log.warn({ err: killErr }, "E2B sandbox kill failed");
      }
    }
  }
}

/**
 * Tiny smoke test: spin up a sandbox, run `echo hello`, kill it. Used by
 * the admin panel to confirm E2B credentials and connectivity work, without
 * spending the credits of a full validation.
 */
export async function e2bSmokeTest(): Promise<{
  ok: boolean;
  durationMs: number;
  output: string;
  reason?: string;
}> {
  const start = Date.now();
  if (!isE2BEnabled()) {
    return { ok: false, durationMs: 0, output: "", reason: "E2B_API_KEY not set" };
  }
  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ timeoutMs: 60_000 });
    const result = await sandbox.commands.run("echo hello-from-e2b", {
      timeoutMs: 15_000,
    });
    return {
      ok: result.exitCode === 0,
      durationMs: Date.now() - start,
      output: result.stdout.trim(),
      reason: result.exitCode === 0 ? undefined : `exit_${result.exitCode}`,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      output: "",
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch {
        // ignore
      }
    }
  }
}
