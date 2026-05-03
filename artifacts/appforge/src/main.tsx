import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { setBaseUrl } from "@workspace/api-client-react";

// Apunta todas las llamadas /api/* al backend.
// En producción usa la variable de entorno VITE_API_URL.
// En desarrollo apunta a localhost:7860.
const apiUrl =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:7860" : "");

setBaseUrl(apiUrl || null);

initSentry();

createRoot(document.getElementById("root")!).render(<App />);
