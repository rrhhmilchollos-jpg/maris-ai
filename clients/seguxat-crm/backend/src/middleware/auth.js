import jwt from "jsonwebtoken";
import Employee from "../models/Employee.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const employee = await Employee.findById(payload.sub);

    if (!employee || !employee.active) {
      return res.status(401).json({ error: "Cuenta no encontrada o desactivada" });
    }

    req.employee = employee;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o caducado" });
  }
}

export function signSession(employee) {
  return jwt.sign({ sub: employee._id.toString(), role: employee.role }, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });
}

// Token corto e intermedio para el paso 2 (verificación con Google),
// emitido solo después de validar email + contraseña correctamente.
export function signPendingVerification(employee) {
  return jwt.sign(
    { sub: employee._id.toString(), step: "google-verify" },
    process.env.JWT_SECRET,
    { expiresIn: "5m" }
  );
}

export function verifyPendingToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.step !== "google-verify") throw new Error("Token de verificación inválido");
  return payload;
}
