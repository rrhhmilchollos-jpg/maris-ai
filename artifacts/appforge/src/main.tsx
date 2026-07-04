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
// Cache bust: 1783140481
