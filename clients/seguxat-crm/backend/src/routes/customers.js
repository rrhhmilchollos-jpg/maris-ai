import express from "express";
import Customer from "../models/Customer.js";
import Lead from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { ROLES } from "../models/Employee.js";

const router = express.Router();
router.use(requireAuth);

function scopeFilter(employee) {
  if (employee.role === ROLES.DIRECTOR) return {};
  return { assignedTo: employee._id };
}

router.get("/", async (req, res) => {
  const { search } = req.query;
  const filter = scopeFilter(req.employee);
  if (search) {
    filter.$or = [
      { name: new RegExp(search, "i") },
      { zone: new RegExp(search, "i") },
    ];
  }
  const customers = await Customer.find(filter)
    .populate("assignedTo", "name zone")
    .sort({ createdAt: -1 });
  res.json({ customers });
});

/**
 * Convertir un lead en cliente activo (al pasar a "instalacion" y completarse
 * la instalación).
 */
router.post("/from-lead/:leadId", async (req, res) => {
  const { status, nextEvent } = req.body || {};
  const lead = await Lead.findOne({ _id: req.params.leadId, ...scopeFilter(req.employee) });
  if (!lead) return res.status(404).json({ error: "Lead no encontrado" });

  const customer = await Customer.create({
    name: lead.name,
    zone: lead.zone,
    kit: lead.kit,
    status: status || "Pendiente instalación",
    nextEvent: nextEvent || "",
    assignedTo: lead.assignedTo,
    convertedFromLead: lead._id,
  });

  res.status(201).json({ customer });
});

router.patch("/:id", async (req, res) => {
  const { status, nextEvent } = req.body || {};
  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, ...scopeFilter(req.employee) },
    { ...(status && { status }), ...(nextEvent !== undefined && { nextEvent }) },
    { new: true }
  );
  if (!customer) return res.status(404).json({ error: "Cliente no encontrado" });
  res.json({ customer });
});

export default router;
