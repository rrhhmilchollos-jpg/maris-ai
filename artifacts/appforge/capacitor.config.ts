import type { CapacitorConfig } from '@capacitor/core';

// Configuración de Capacitor para envolver Maris AI como app híbrida
// Android/iOS. webDir apunta al mismo `dist/` que genera `pnpm build`
// (Vite + prerender.mjs) — es literalmente la misma web, sin duplicar
// código ni mantener una versión aparte.
const config: CapacitorConfig = {
  // appId: identificador único e IRREVERSIBLE una vez publicado en Google
  // Play — no se puede cambiar después sin publicar como app nueva.
  // Formato inverso de dominio, estándar en Android/iOS.
  appId: 'es.marisai.app',
  appName: 'Maris AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Mismo background_color que public/manifest.json (PWA) — evita un
    // flash de color distinto entre el splash nativo y la carga de la web.
    backgroundColor: '#0a0a0f',
  },
};

export default config;

