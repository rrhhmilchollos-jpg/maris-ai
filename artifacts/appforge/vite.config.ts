import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const clerkPubKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? "";
const clerkProxyUrl = process.env.VITE_CLERK_PROXY_URL ?? "";

// WebContainer requires cross-origin isolation (SharedArrayBuffer).
// These headers must be present on EVERY response from the dev server and
// the production Vercel deployment (vercel.json handles the latter).
const ISOLATION_HEADERS = {
  // same-origin-allow-popups: allows Clerk OAuth popups while still isolating
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  // credentialless: looser than require-corp but still enables SharedArrayBuffer
  // in Chrome 96+ and Edge 96+. Needed for WebContainer.boot() to succeed.
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  base: "/",
  server: {
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPubKey),
    "import.meta.env.VITE_CLERK_PROXY_URL": JSON.stringify(clerkProxyUrl),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@workspace/api-client-react": path.resolve(__dirname, "../../lib/api-client-react/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Code splitting manual para reducir JS no usado en carga inicial
        manualChunks(id) {
          // Clerk auth — chunk separado, se carga solo cuando se necesita
          if (id.includes("@clerk/clerk-react") || id.includes("clerk.browser")) {
            return "vendor-clerk";
          }
          // Framer Motion — chunk separado (animaciones, no crítico)
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          // Iconos Lucide — chunk separado
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          // Componentes Radix UI — chunk separado
          if (id.includes("@radix-ui")) {
            return "vendor-ui";
          }
          // React core
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }
          // TanStack Query + router
          if (id.includes("@tanstack/react-query") || id.includes("wouter")) {
            return "vendor-router";
          }
        },
      },
    },
  },
});
