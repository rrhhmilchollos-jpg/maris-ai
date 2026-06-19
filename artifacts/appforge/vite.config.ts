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
  },
});
