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
    // Compresión Brotli — máxima compresión, soportada por todos los navegadores modernos
    compression({
      algorithm: "brotliCompress",
      exclude: [/\.(png|jpe?g|gif|svg|webp|ico|woff2?)$/],
      threshold: 1024, // solo comprimir archivos >1KB
    }),
    // Compresión Gzip — fallback para navegadores sin soporte Brotli
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
    chunkSizeWarningLimit: 300,
    target: "ES2020",
    modulePreload: { polyfill: false },
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 4,
        pure_funcs: ["console.log", "console.debug"],
        unsafe: true,
        unsafe_methods: true,
        dead_code: true,
        unused: true,
      },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    cssMinify: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    sourcemap: false,
    rollupOptions: {
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        unknownGlobalSideEffects: false,
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Clerk — carga diferida, solo cuando el usuario intenta autenticarse
            if (id.includes("@clerk/clerk-react") || id.includes("clerk.browser")) return "vendor-clerk";
            // Framer Motion — animaciones, no crítico para la carga inicial
            if (id.includes("framer-motion")) return "vendor-motion";
            // Lucide — iconos, carga bajo demanda
            if (id.includes("lucide-react")) return "vendor-icons";
            // React Icons — separado de lucide para mejor splitting
            if (id.includes("react-icons")) return "vendor-react-icons";
            // Radix UI — componentes UI base
            if (id.includes("@radix-ui")) return "vendor-ui";
            // React core — siempre necesario, chunk pequeño y cacheable
            if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
            // Router y query — críticos para la SPA
            if (id.includes("@tanstack/react-query") || id.includes("wouter")) return "vendor-router";
            // Formularios — solo en páginas con formularios
            if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "vendor-forms";
            // Charts — solo en dashboard, carga diferida
            if (id.includes("recharts") || id.includes("d3")) return "vendor-charts";
            // Editor Monaco — muy pesado, carga diferida
            if (id.includes("monaco-editor")) return "vendor-editor";
            // Syntax highlighting — carga diferida
            if (id.includes("shiki") || id.includes("prismjs")) return "vendor-highlight";
            // Sandpack — solo en páginas de preview, muy pesado
            if (id.includes("@codesandbox/sandpack")) return "vendor-sandpack";
            // WebContainer — solo en páginas de desarrollo
            if (id.includes("@webcontainer")) return "vendor-webcontainer";
            // Sentry — monitorización, no crítico
            if (id.includes("@sentry")) return "vendor-sentry";
            // Date utils — pequeño, puede ir con forms
            if (id.includes("date-fns")) return "vendor-forms";
            // Carousel y otros componentes UI menores
            if (id.includes("embla-carousel") || id.includes("vaul") || id.includes("sonner") || id.includes("cmdk")) return "vendor-ui-extras";
            // Resto de vendor
            return "vendor-others";
          }
        },
      },
    },
  },
});
