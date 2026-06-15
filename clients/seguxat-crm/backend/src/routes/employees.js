import express from "express";
import Employee, { ROLES } from "../models/Employee.js";
import { requireAuth } from "../middleware/auth.js";
import { onlyDirector } from "../middleware/requireRole.js";

const router = express.Router();

router.use(requireAuth);

// Listar empleados (solo director)
router.get("/", onlyDirector, async (req, res) => {
  const employees = await Employee.find().sort({ createdAt: -1 });
  res.json({ employees });
});

/**
 * Dar de alta un nuevo empleado.
 *
 * Solo el director puede crear cuentas. La contraseña se introduce AQUÍ,
 * en este momento, desde la app ya en ejecución — nunca queda escrita en
 * el código fuente. El empleado podrá cambiarla más adelante y deberá
 * vincular su cuenta de Google la primera vez que inicie sesión (paso 2
 * de la verificación).
 *
 * Body: { name, email, password, role, zone }
 */
router.post("/", onlyDirector, async (req, res) => {
  const { name, email, password, role, zone } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Nombre, email y contraseña son obligatorios" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }
  if (role && !Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: "Rol no válido" });
  }

  const existing = await Employee.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return res.status(409).json({ error: "Ya existe un empleado con ese email" });
  }

  const employee = await Employee.create({
    name,
    email: email.toLowerCase().trim(),
    passwordHash: await Employee.hashPassword(password),
    role: role || ROLES.COMERCIAL,
    zone: zone || "",
    createdBy: req.employee._id,
  });

  res.status(201).json({ employee });
});

// Activar / desactivar un empleado
router.patch("/:id/active", onlyDirector, async (req, res) => {
  const { active } = req.body || {};
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: "Empleado no encontrado" });

  if (employee.role === ROLES.DIRECTOR && employee._id.equals(req.employee._id) && active === false) {
    return res.status(400).json({ error: "No puedes desactivar tu propia cuenta de director" });
  }

  employee.active = !!active;
  await employee.save();
  res.json({ employee });
});

// Cambiar rol
router.patch("/:id/role", onlyDirector, async (req, res) => {
  const { role } = req.body || {};
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: "Rol no válido" });
  }

  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: "Empleado no encontrado" });

  employee.role = role;
  await employee.save();
  res.json({ employee });
});

// Restablecer contraseña de un empleado (el director la introduce aquí mismo)
router.post("/:id/reset-password", onlyDirector, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  }

  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: "Empleado no encontrado" });

  employee.passwordHash = await Employee.hashPassword(password);
  await employee.save();
  res.json({ ok: true });
});

export default router;
