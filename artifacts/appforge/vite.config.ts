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
      },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    cssMinify: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@clerk/clerk-react") || id.includes("clerk.browser")) return "vendor-clerk";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("react-icons")) return "vendor-react-icons";
            if (id.includes("@radix-ui")) return "vendor-ui";
            if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
            if (id.includes("@tanstack/react-query") || id.includes("wouter")) return "vendor-router";
            if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "vendor-forms";
            if (id.includes("recharts") || id.includes("d3")) return "vendor-charts";
            if (id.includes("monaco-editor")) return "vendor-editor";
            if (id.includes("shiki") || id.includes("prismjs")) return "vendor-highlight";
            if (id.includes("@codesandbox/sandpack")) return "vendor-sandpack";
            if (id.includes("@webcontainer")) return "vendor-webcontainer";
            if (id.includes("@sentry")) return "vendor-sentry";
            if (id.includes("date-fns")) return "vendor-forms";
            if (id.includes("embla-carousel") || id.includes("vaul") || id.includes("sonner") || id.includes("cmdk")) return "vendor-ui-extras";
            return "vendor-others";
          }
        },
      },
    },
  },
});
