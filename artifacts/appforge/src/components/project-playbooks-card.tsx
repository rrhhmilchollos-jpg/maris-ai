import { useListProjectPlaybooks } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookMarked, Loader2 } from "lucide-react";

/**
 * Visibilidad del sistema de aprendizaje de patrones de proyecto (a
 * petición explícita del usuario: "aprender como Emergent.sh, cueste lo
 * que cueste" + "quiero VER que esto funciona de verdad", tras la
 * experiencia previa con la memoria de errores que llevaba un mes
 * prácticamente vacía sin que nadie lo supiera).
 *
 * Vacío al principio es NORMAL y ESPERADO: solo se aprende de proyectos
 * con score >= 85 confirmado por el evaluador de calidad, así que hacen
 * falta generaciones reales de calidad alta para que aparezca contenido
 * aquí — no es un fallo si tarda en llenarse.
 */
export function ProjectPlaybooksCard() {
  const { data, isLoading } = useListProjectPlaybooks();

  return (
    <Card className="bg-card/40 border-white/5">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <BookMarked className="h-5 w-5 text-emerald-300" />
          Playbooks de proyecto aprendidos
        </CardTitle>
        <p className="text-sm text-white/60 mt-1">
          Patrones estructurales destilados de proyectos reales con calidad alta confirmada (score ≥ 85),
          agrupados por tipo de negocio. Se inyectan en el Architect al generar un proyecto nuevo de la
          misma vertical. Vacío al principio es normal — se llena con el uso real de la plataforma.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
        ) : !data || data.total === 0 ? (
          <p className="text-sm text-white/50 py-8 text-center">
            Aún no se ha aprendido ningún patrón — hace falta al menos una generación real con score de calidad ≥ 85 en alguna vertical de negocio detectada.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.byVertical as Record<string, number>).map(([vertical, count]) => (
                <Badge key={vertical} variant="outline" className="text-xs">
                  {vertical}: {count}
                </Badge>
              ))}
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {data.playbooks.map((p: any) => (
                <div key={p.id} className="text-xs bg-white/[0.02] border border-white/5 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[10px]">{p.businessVertical}</Badge>
                    <span className="text-white/40">score {p.qualityScore}/100</span>
                    <span className="text-white/40">· reutilizado {p.timesReused}x</span>
                    <span className="text-white/30 ml-auto">{new Date(p.createdAt).toLocaleDateString("es-ES")}</span>
                  </div>
                  <p className="text-white/70">{p.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
