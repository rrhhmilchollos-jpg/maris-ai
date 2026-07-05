import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { RouteAwareErrorBoundary } from "./components/error-boundary";

initSentry();
createRoot(document.getElementById("root")!).render(
  <RouteAwareErrorBoundary>
    <App />
  </RouteAwareErrorBoundary>
);

// Registro del service worker (network-first, ver public/sw.js) — solo en
// producción, para no interferir con el hot-reload de Vite en desarrollo.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silencioso: un fallo de registro del SW nunca debe romper la app
    });
  });
}

// Cache bust: 1783140481
