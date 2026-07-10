import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { compression } from "vite-plugin-compression2";

const clerkPubKeyFallback = process.env.CLERK_PUBLISHABLE_KEY ?? "";

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Embedder-Policy": "unsafe-none",
};

// ENCONTRADO A PETICIÓN DEL USUARIO (Lighthouse real: CSS bloqueando el
// renderizado inicial, ~350ms de ahorro estimado). Vite inyecta
// automáticamente <link rel="stylesheet" href="..."> para el CSS del
// build -- bloqueante por diseño (el navegador espera a tenerlo antes de
// pintar, para evitar contenido sin estilos). No es algo que se pueda
// tocar en el index.html fuente porque Vite lo genera después del
// build, con el nombre de archivo con hash final.
//
// FIX: plugin real que intercepta el HTML final (transformIndexHtml,
// se ejecuta DESPUÉS de que Vite ya inyectó el link) y lo convierte al
// mismo patrón "precarga + onload" ya usado con las fuentes de Google
// -- el navegador descarga el CSS en paralelo sin bloquear el primer
// pintado, y lo aplica en cuanto está listo. Riesgo de FOUC (contenido
// sin estilos un instante) minimizado porque el esqueleto de carga
// (#root:empty::after, .maris-hero-skeleton) ya está incrustado como
// CSS inline en el propio index.html, no depende de este archivo.
function deferMainCss(): Plugin {
  return {
    name: "defer-main-css",
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/g,
        (_match, href) =>
          `<link rel="preload" as="style" href="${href}" />` +
          `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" />` +
          `<noscript><link rel="stylesheet" href="${href}" /></noscript>`,
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
    deferMainCss(),
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
        manualChunks: {
          "vendor-clerk": ["@clerk/react", "@clerk/themes", "@clerk/localizations"],
          "vendor-charts": ["recharts"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
});
