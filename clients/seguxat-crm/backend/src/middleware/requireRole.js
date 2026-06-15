import { ROLES } from "../models/Employee.js";

/**
 * Restringe una ruta a uno o varios roles.
 * Uso: router.post("/empleados", requireAuth, requireRole(ROLES.DIRECTOR), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.employee) {
      return res.status(401).json({ error: "No autenticado" });
    }
    if (!allowedRoles.includes(req.employee.role)) {
      return res.status(403).json({ error: "No tienes permisos para esta acción" });
    }
    next();
  };
}

export const onlyDirector = requireRole(ROLES.DIRECTOR);
