import mongoose from "mongoose";
import { KIT_TYPES } from "./Lead.js";

export const CUSTOMER_STATUSES = ["Activo", "Pendiente instalación", "Suspendido"];

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    zone: { type: String, required: true },
    kit: { type: String, enum: KIT_TYPES, required: true },
    status: { type: String, enum: CUSTOMER_STATUSES, default: "Pendiente instalación" },

    since: { type: Date, default: Date.now }, // fecha de alta como cliente
    nextEvent: { type: String, default: "" }, // p.ej. "Revisión 09/2026"

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    convertedFromLead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Customer", customerSchema);
