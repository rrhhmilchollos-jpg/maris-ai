import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// Roles disponibles en el CRM de Seguxat
export const ROLES = {
  DIRECTOR: "director", // acceso total: gestionar empleados, ver todo, moderar
  COMERCIAL: "comercial", // acceso a su propio pipeline, agenda y clientes asignados
};

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    role: { type: String, enum: Object.values(ROLES), default: ROLES.COMERCIAL },
    zone: { type: String, default: "" }, // p.ej. "Ruzafa / Eixample"

    // Verificación en dos pasos vía Google: el empleado debe vincular su
    // cuenta de Google (debe coincidir el email) antes de poder iniciar sesión.
    googleId: { type: String, default: null },
    googleLinkedAt: { type: Date, default: null },

    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true }
);

employeeSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

employeeSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 12);
};

// Nunca devolver el hash de la contraseña en JSON
employeeSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export default mongoose.model("Employee", employeeSchema);
