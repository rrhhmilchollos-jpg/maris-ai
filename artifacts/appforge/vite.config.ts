import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const clerkPubKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY ?? "";

export default defineConfig({
  base: "/",
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(clerkPubKey),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // ✅ CORRECTO: apunta al paquete real en lib/api-client-react/src
      "@workspace/api-client-react": path.resolve(__dirname, "../../lib/api-client-react/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
