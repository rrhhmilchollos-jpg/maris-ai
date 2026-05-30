import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const clerkPubKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? "";

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
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
  },
  plugins: [
    react(),
    tailwindcss({ optimize: true }),
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
    chunkSizeWarningLimit: 500, // Bajamos el límite para ser más estrictos con el rendimiento
    minify: "terser", // Minificación más agresiva
    terserOptions: {
      compress: {
        drop_console: true, // Elimina console.logs en producción
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@clerk/clerk-react") || id.includes("clerk.browser")) return "vendor-clerk";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@radix-ui")) return "vendor-ui";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "vendor-react";
          if (id.includes("@tanstack/react-query") || id.includes("wouter")) return "vendor-router";
          // Separar el editor de código y el preview que son los más pesados
          if (id.includes("monaco-editor") || id.includes("debug-preview")) return "vendor-editor";
        },
      },
    },
  },
});
