/**
 * githubPushConditional.ts
 * 
 * Versión mejorada de GitHub Push con lógica de exportación condicional.
 * Filtra contenido según gasto del usuario y complejidad de la app.
 */

import { Octokit } from "@octokit/rest";
import { checkExportPermissions, filterExportContent } from "./userSpendingValidator";
import { logger } from "./logger";

export interface GitHubPushOptions {
  owner: string;
  repo: string;
  token: string;
  app: any;
  userId: string;
  message?: string;
}

export interface GitHubPushResult {
  success: boolean;
  repoUrl?: string;
  exportType: "frontend-only" | "full";
  filesUploaded: number;
  error?: string;
}

/**
 * Realiza push a GitHub con lógica de exportación condicional
 */
export async function pushAppToGitHubConditional(
  opts: GitHubPushOptions
): Promise<GitHubPushResult> {
  try {
    logger.info(
      { owner: opts.owner, repo: opts.repo, userId: opts.userId },
      "Starting conditional GitHub push"
    );

    // Verificar permisos de exportación
    const permissions = await checkExportPermissions(opts.userId, opts.app);
    logger.info(
      { userId: opts.userId, permissions },
      "Export permissions checked"
    );

    // Filtrar contenido según permisos
    const exportContent = filterExportContent(
      opts.app,
      permissions.canExportFull
    );

    // Inicializar cliente de GitHub
    const octokit = new Octokit({ auth: opts.token });

    // Verificar que el repo pertenece al usuario
    const repo = await octokit.repos.get({
      owner: opts.owner,
      repo: opts.repo,
    });

    if (repo.data.owner?.login !== opts.owner) {
      logger.error(
        { owner: opts.owner, actualOwner: repo.data.owner?.login },
        "Repository owner mismatch"
      );
      return {
        success: false,
        exportType: permissions.canExportFull ? "full" : "frontend-only",
        filesUploaded: 0,
        error: "Repository owner mismatch",
      };
    }

    // Preparar archivos a subir
    const files: Record<string, string> = {};

    // Siempre subir frontend
    files["src/App.tsx"] = exportContent.frontendCode;
    files["src/main.tsx"] = generateMainTsx();
    files["package.json"] = exportContent.packageJson || generatePackageJson(opts.app);
    files["tsconfig.json"] = generateTsConfig();
    files["vite.config.ts"] = generateViteConfig();
    files[".gitignore"] = generateGitignore();
    files["README.md"] = generateReadme(opts.app, permissions.canExportFull);

    // Si tiene permisos, subir backend
    if (permissions.canExportFull && exportContent.backendCode) {
      files["server/index.ts"] = exportContent.backendCode;
      files["server/package.json"] = generateServerPackageJson(opts.app);
    }

    // Subir archivos a GitHub
    let filesUploaded = 0;
    for (const [filePath, content] of Object.entries(files)) {
      try {
        await octokit.repos.createOrUpdateFileContents({
          owner: opts.owner,
          repo: opts.repo,
          path: filePath,
          message: opts.message || `Update ${filePath}`,
          content: Buffer.from(content).toString("base64"),
        });
        filesUploaded++;
        logger.debug({ filePath }, "File uploaded to GitHub");
      } catch (error) {
        logger.warn({ filePath, error }, "Failed to upload file");
      }
    }

    const repoUrl = `https://github.com/${opts.owner}/${opts.repo}`;
    logger.info(
      {
        repoUrl,
        filesUploaded,
        exportType: permissions.canExportFull ? "full" : "frontend-only",
      },
      "GitHub push completed successfully"
    );

    return {
      success: true,
      repoUrl,
      exportType: permissions.canExportFull ? "full" : "frontend-only",
      filesUploaded,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg, userId: opts.userId }, "GitHub push failed");

    return {
      success: false,
      exportType: "frontend-only",
      filesUploaded: 0,
      error: errorMsg,
    };
  }
}

/**
 * Genera main.tsx
 */
function generateMainTsx(): string {
  return `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`;
}

/**
 * Genera package.json
 */
function generatePackageJson(app: any): string {
  return JSON.stringify(
    {
      name: app.name.toLowerCase().replace(/\s+/g, "-"),
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
      devDependencies: {
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
        "@vitejs/plugin-react": "^4.0.0",
        typescript: "^5.0.0",
        vite: "^5.0.0",
      },
    },
    null,
    2
  );
}

/**
 * Genera server/package.json
 */
function generateServerPackageJson(app: any): string {
  return JSON.stringify(
    {
      name: `${app.name.toLowerCase().replace(/\s+/g, "-")}-server`,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "tsx watch src/index.ts",
        build: "tsc",
        start: "node dist/index.js",
      },
      dependencies: {
        express: "^4.18.0",
        cors: "^2.8.5",
      },
      devDependencies: {
        "@types/express": "^4.17.0",
        "@types/node": "^20.0.0",
        typescript: "^5.0.0",
        tsx: "^3.0.0",
      },
    },
    null,
    2
  );
}

/**
 * Genera tsconfig.json
 */
function generateTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        strictFunctionTypes: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
      },
      include: ["src"],
      references: [{ path: "./tsconfig.node.json" }],
    },
    null,
    2
  );
}

/**
 * Genera vite.config.ts
 */
function generateViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
`;
}

/**
 * Genera .gitignore
 */
function generateGitignore(): string {
  return `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Environment variables
.env
.env.local
.env.*.local
`;
}

/**
 * Genera README.md
 */
function generateReadme(app: any, isFullExport: boolean): string {
  const exportType = isFullExport
    ? "Full Stack (Frontend + Backend)"
    : "Frontend Only";

  return `# ${app.name}

Generated with Maris AI

## Export Type
${exportType}

## Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm

### Installation

\`\`\`bash
npm install
\`\`\`

### Development

\`\`\`bash
npm run dev
\`\`\`

### Build

\`\`\`bash
npm run build
\`\`\`

### Preview

\`\`\`bash
npm run preview
\`\`\`

${
  isFullExport
    ? `
## Backend

The backend is located in the \`server/\` directory.

\`\`\`bash
cd server
npm install
npm run dev
\`\`\`
`
    : ""
}

## License
MIT
`;
}
