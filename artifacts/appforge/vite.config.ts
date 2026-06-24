import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { compression } from "vite-plugin-compression2";

const clerkPubKeyFallback = process.env.CLERK_PUBLISHABLE_KEY ?? "";

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Embedder-Policy": "unsafe-none",
};

// Plugin que convierte el CSS del bundle en no bloqueante
function deferNonCriticalCSS() {
  return {
    name: "defer-non-critical-css",
    apply: "build" as const,
    transformIndexHtml(html: string) {
      // Vite inyecta el CSS así: <link rel="stylesheet" crossorigin href="/assets/xxx.css">
      // Lo convertimos en preload no bloqueante
      return html.replace(
        /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g,
        (_, href) =>
          `<link rel="preload" as="style" href="${href}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${href}"></noscript>`
      );
    },
  };
}

export default defineConfig({
  base: "/",
  server: {
    headers: ISOLATION_HEADERS,
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
  define: {
    ...(clerkPubKeyFallback && !process.env.VITE_CLERK_PUBLISHABLE_KEY
      ? { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPubKeyFallback) }
      : {}),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: true }),
    deferNonCriticalCSS(),
    compression({
      algorithm: "brotliCompress",
      exclude: [/\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/],
      threshold: 1024,
    }),
    compression({
      algorithm: "gzip",
      exclude: [/\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/],
      threshold: 1024,
    }),
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
    chunkSizeWarningLimit: 500,
    target: "ES2020",
    modulePreload: { polyfill: false },
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
        pure_funcs: ["console.log", "console.debug"],
      },
      mangle: true,
      format: { comments: false },
    },
    cssMinify: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Code splitting agresivo — cada vendor en su propio chunk cacheado
        manualChunks: (id: string) => {
          // Vendor chunks — se cachean por separado en el navegador
          if (id.includes("node_modules")) {
            // React core — crítico, chunk pequeño propio
            if (id.includes("react-dom") || id.includes("react/")) return "react-core";
            // Clerk auth — se carga solo en rutas autenticadas
            if (id.includes("@clerk")) return "clerk";
            // Framer Motion — solo en landing, chunk separado
            if (id.includes("framer-motion")) return "framer";
            // Radix UI components — UI library
            if (id.includes("@radix-ui")) return "radix";
            // Stripe — solo en billing
            if (id.includes("@stripe") || id.includes("stripe")) return "stripe";
            // Tanstack Query — data fetching
            if (id.includes("@tanstack")) return "tanstack";
            // Lucide icons — grande, chunk propio
            if (id.includes("lucide-react")) return "lucide";
            // Date utils
            if (id.includes("date-fns")) return "date-fns";
            // Recharts — solo en dashboard
            if (id.includes("recharts") || id.includes("d3-")) return "charts";
            // Everything else vendor
            return "vendor";
          }
          // App chunks por sección
          if (id.includes("/pages/admin")) return "admin";
          if (id.includes("/pages/billing")) return "billing";
          if (id.includes("/pages/legal")) return "legal";
          if (id.includes("/pages/landing")) return "landing";
        },
      },
    },
  },
});
