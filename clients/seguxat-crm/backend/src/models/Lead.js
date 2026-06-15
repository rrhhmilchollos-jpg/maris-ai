import mongoose from "mongoose";

export const STAGES = [
  "nuevo",
  "contactado",
  "cita",
  "visita",
  "propuesta",
  "contrato",
  "instalacion",
];

export const KIT_TYPES = ["esencial", "total", "negocio"];

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    zone: { type: String, required: true },
    phone: { type: String, default: "" },
    kit: { type: String, enum: KIT_TYPES, required: true },
    source: { type: String, default: "Web" },
    stage: { type: String, enum: STAGES, default: "nuevo" },
    cita: { type: String, default: null }, // texto libre, p.ej. "Hoy · 17:30"
    notes: { type: String, default: "" },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },

    stageChangedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Lead", leadSchema);
