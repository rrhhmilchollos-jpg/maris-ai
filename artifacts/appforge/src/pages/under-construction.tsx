/**
 * Página de fallback para el modo en construcción.
 *
 * El control real de acceso se realiza en MaintenanceGate; si esta ruta se
 * alcanza accidentalmente, se vuelve a la portada para no dejar al usuario
 * en una pantalla sin contenido.
 */
import { useEffect } from "react";

export default function UnderConstructionPage() {
  useEffect(() => {
    window.location.href = "/";
  }, []);

  return null;
}
