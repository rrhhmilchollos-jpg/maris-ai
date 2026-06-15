import express from "express";
import { OAuth2Client } from "google-auth-library";
import Employee from "../models/Employee.js";
import {
  requireAuth,
  signSession,
  signPendingVerification,
  verifyPendingToken,
} from "../middleware/auth.js";

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * PASO 1 — Email + contraseña.
 * - Si las credenciales son correctas y el empleado ya vinculó su cuenta de
 *   Google, devolvemos un `pendingToken` de corta duración y el frontend
 *   debe completar el paso 2 (verificación con Google).
 * - Si todavía no ha vinculado Google, le pedimos que lo haga ahora mismo
 *   (primer inicio de sesión).
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son obligatorios" });
  }

  const employee = await Employee.findOne({ email: email.toLowerCase().trim() });
  if (!employee || !employee.active) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  const valid = await employee.comparePassword(password);
  if (!valid) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }

  const pendingToken = signPendingVerification(employee);

  if (employee.googleId) {
    return res.json({
      step: "google-verify",
      pendingToken,
      message: "Verifica tu identidad con tu cuenta de Google para continuar.",
    });
  }

  return res.json({
    step: "google-link-required",
    pendingToken,
    message: "Primer inicio de sesión: vincula tu cuenta de Google para activar la verificación en dos pasos.",
  });
});

/**
 * PASO 2 — Verificación con Google (cuenta ya vinculada).
 * El frontend obtiene un ID token de Google Sign-In y lo envía aquí junto
 * con el `pendingToken` del paso 1.
 */
router.post("/google-verify", async (req, res) => {
  const { pendingToken, googleIdToken } = req.body || {};
  if (!pendingToken || !googleIdToken) {
    return res.status(400).json({ error: "Faltan datos de verificación" });
  }

  let payload;
  try {
    payload = verifyPendingToken(pendingToken);
  } catch {
    return res.status(401).json({ error: "La verificación ha caducado, vuelve a iniciar sesión" });
  }

  const employee = await Employee.findById(payload.sub);
  if (!employee || !employee.active) {
    return res.status(401).json({ error: "Cuenta no encontrada o desactivada" });
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: googleIdToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const googlePayload = ticket.getPayload();

  if (googlePayload.sub !== employee.googleId) {
    return res.status(401).json({ error: "La cuenta de Google no coincide con la vinculada" });
  }
  if (googlePayload.email.toLowerCase() !== employee.email) {
    return res.status(401).json({ error: "El email de Google no coincide con tu cuenta Seguxat" });
  }

  const token = signSession(employee);
  return res.json({ token, employee });
});

/**
 * Vincular cuenta de Google (primer inicio de sesión, o re-vinculación
 * realizada por un director).
 */
router.post("/google-link", async (req, res) => {
  const { pendingToken, googleIdToken } = req.body || {};
  if (!pendingToken || !googleIdToken) {
    return res.status(400).json({ error: "Faltan datos de verificación" });
  }

  let payload;
  try {
    payload = verifyPendingToken(pendingToken);
  } catch {
    return res.status(401).json({ error: "La verificación ha caducado, vuelve a iniciar sesión" });
  }

  const employee = await Employee.findById(payload.sub);
  if (!employee || !employee.active) {
    return res.status(401).json({ error: "Cuenta no encontrada o desactivada" });
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: googleIdToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const googlePayload = ticket.getPayload();

  if (googlePayload.email.toLowerCase() !== employee.email) {
    return res.status(400).json({
      error: `La cuenta de Google (${googlePayload.email}) no coincide con tu email de Seguxat (${employee.email})`,
    });
  }

  employee.googleId = googlePayload.sub;
  employee.googleLinkedAt = new Date();
  await employee.save();

  const token = signSession(employee);
  return res.json({ token, employee });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ employee: req.employee });
});

export default router;
