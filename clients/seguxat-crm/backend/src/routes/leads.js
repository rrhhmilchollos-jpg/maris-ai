import express from "express";
import Lead, { STAGES } from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { ROLES } from "../models/Employee.js";

const router = express.Router();
router.use(requireAuth);

// Director ve todo el pipeline; un comercial solo ve lo suyo.
function scopeFilter(employee) {
  if (employee.role === ROLES.DIRECTOR) return {};
  return { assignedTo: employee._id };
}

router.get("/", async (req, res) => {
  const leads = await Lead.find(scopeFilter(req.employee))
    .populate("assignedTo", "name initials zone")
    .sort({ updatedAt: -1 });
  res.json({ leads });
});

router.post("/", async (req, res) => {
  const { name, zone, phone, kit, source, assignedTo, cita } = req.body || {};
  if (!name || !zone || !kit) {
    return res.status(400).json({ error: "name, zone y kit son obligatorios" });
  }

  // Un comercial solo puede crear leads para sí mismo; el director puede asignar a cualquiera.
  const assignee =
    req.employee.role === ROLES.DIRECTOR && assignedTo ? assignedTo : req.employee._id;

  const lead = await Lead.create({
    name,
    zone,
    phone,
    kit,
    source,
    cita,
    stage: "nuevo",
    assignedTo: assignee,
    createdBy: req.employee._id,
  });

  res.status(201).json({ lead });
});

// Mover de fase (+1 / -1) o establecer una fase concreta
router.patch("/:id/stage", async (req, res) => {
  const { direction, stage } = req.body || {};
  const lead = await Lead.findOne({ _id: req.params.id, ...scopeFilter(req.employee) });
  if (!lead) return res.status(404).json({ error: "Lead no encontrado" });

  if (stage) {
    if (!STAGES.includes(stage)) return res.status(400).json({ error: "Fase no válida" });
    lead.stage = stage;
  } else if (direction === 1 || direction === -1) {
    const idx = STAGES.indexOf(lead.stage);
    const next = Math.min(STAGES.length - 1, Math.max(0, idx + direction));
    lead.stage = STAGES[next];
  } else {
    return res.status(400).json({ error: "Indica `stage` o `direction` (1 / -1)" });
  }

  lead.stageChangedAt = new Date();
  await lead.save();
  res.json({ lead });
});

router.patch("/:id/notes", async (req, res) => {
  const { notes } = req.body || {};
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, ...scopeFilter(req.employee) },
    { notes: notes || "" },
    { new: true }
  );
  if (!lead) return res.status(404).json({ error: "Lead no encontrado" });
  res.json({ lead });
});

export default router;
