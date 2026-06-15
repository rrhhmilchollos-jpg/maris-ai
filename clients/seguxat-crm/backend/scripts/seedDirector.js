/**
 * Crea la cuenta inicial de DIRECTOR a partir de variables de entorno.
 *
 * Uso:
 *   1. Copia .env.example a .env y rellena DIRECTOR_NAME / DIRECTOR_EMAIL /
 *      DIRECTOR_PASSWORD con tus datos reales (NO subas ese .env a git).
 *   2. Ejecuta: npm run seed:director
 *
 * Este script es idempotente: si ya existe un empleado con ese email,
 * solo se asegura de que su rol sea "director" y está activo.
 */
import "dotenv/config";
import { connectDB } from "../src/config/db.js";
import Employee, { ROLES } from "../src/models/Employee.js";
import mongoose from "mongoose";

async function main() {
  const { DIRECTOR_NAME, DIRECTOR_EMAIL, DIRECTOR_PASSWORD } = process.env;

  if (!DIRECTOR_NAME || !DIRECTOR_EMAIL || !DIRECTOR_PASSWORD) {
    console.error(
      "Faltan DIRECTOR_NAME / DIRECTOR_EMAIL / DIRECTOR_PASSWORD en el .env. " +
        "Rellénalos antes de ejecutar este script."
    );
    process.exit(1);
  }

  await connectDB();

  const email = DIRECTOR_EMAIL.toLowerCase().trim();
  let employee = await Employee.findOne({ email });

  if (employee) {
    employee.role = ROLES.DIRECTOR;
    employee.active = true;
    await employee.save();
    console.log(`[seed] Empleado existente actualizado a director: ${email}`);
  } else {
    employee = await Employee.create({
      name: DIRECTOR_NAME,
      email,
      passwordHash: await Employee.hashPassword(DIRECTOR_PASSWORD),
      role: ROLES.DIRECTOR,
      zone: "Toda Valencia",
    });
    console.log(`[seed] Cuenta de director creada: ${email}`);
  }

  console.log(
    "[seed] Recuerda: en el primer inicio de sesión deberás vincular tu cuenta de Google " +
      "(verificación en dos pasos)."
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
