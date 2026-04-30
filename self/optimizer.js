// Self-Improvement Engine — Optimizer (Fase 9 PRO)
//
// Lee el informe del analyzer y emite eventos de optimización en el bus.
// Otro componente (workers, supervisor, etc.) decide qué hacer con cada
// acción.

const { emit } = require("../communication/bus");

function optimize(report) {
  if (report.slowTasks?.length > 5) {
    emit("system:optimize", {
      action: "increase_workers",
    });
  }

  if (report.failedTasks?.length > 0) {
    emit("system:optimize", {
      action: "improve_retries",
    });
  }
}

module.exports = { optimize };
