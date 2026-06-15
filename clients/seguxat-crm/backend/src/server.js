import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";

import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";
import leadRoutes from "./routes/leads.js";
import customerRoutes from "./routes/customers.js";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "seguxat-crm-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/customers", customerRoutes);

// Manejador de errores genérico
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[server] Seguxat CRM API escuchando en :${PORT}`));
  })
  .catch((err) => {
    console.error("[db] No se pudo conectar a MongoDB:", err.message);
    process.exit(1);
  });
