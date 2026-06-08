import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Nota: VITE_CLERK_PUBLISHABLE_KEY se expone automáticamente por Vite a través de import.meta.env
// No es necesario el bloque "define" — Vite ya maneja las variables VITE_* correctamente.
// El bloque "define" anterior sobreescribía la variable con el valor del entorno de BUILD,
// lo que causaba que quedara vacía si la variable no estaba definida al compilar.

// Si CLERK_PUBLISHABLE_KEY está definida (sin el prefijo VITE_), la exponemos también.
const clerkPubKeyFallback = process.env.CLERK_PUBLISHABLE_KEY ?? "";

// COOP: same-origin + COEP: credentialless → habilita crossOriginIsolated = true en /app/*
// En Vercel, estos headers se aplican solo a /app/* para no romper el login OAuth de Clerk
// En desarrollo local (vite dev), los aplicamos globalmente ya que no hay login OAuth
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
    // Solo inyectar el fallback si VITE_CLERK_PUBLISHABLE_KEY no está definida
    // Esto permite que Vercel inyecte la variable en tiempo de build correctamente
    ...(clerkPubKeyFallback && !process.env.VITE_CLERK_PUBLISHABLE_KEY
      ? { "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPubKeyFallback) }
      : {}),
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
    chunkSizeWarningLimit: 1000, // Aumentamos el límite ya que hemos optimizado el chunking manual
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
          if (id.includes("node_modules")) {
            if (id.includes("@clerk/clerk-react") || id.includes("clerk.browser")) return "vendor-clerk";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("@radix-ui")) return "vendor-ui";
            if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
            if (id.includes("@tanstack/react-query") || id.includes("wouter")) return "vendor-router";
            if (id.includes("monaco-editor")) return "vendor-editor";
            if (id.includes("shiki") || id.includes("prismjs")) return "vendor-highlight";
            return "vendor-others";
          }
        },
      },
    },
  },
});
