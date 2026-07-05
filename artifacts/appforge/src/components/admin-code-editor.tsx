/**
 * admin-code-editor.tsx
 *
 * Editor de código completo (multi-archivo, con resaltado de sintaxis)
 * para la pestaña "Código" de un proyecto — SOLO visible para cuentas
 * admin/propietario (gate hecho por el padre con `isAdmin`, no aquí).
 *
 * Diseño: usamos parseBundle/serializeBundle (rutas REALES del proyecto,
 * ej. "src/App.tsx") en vez de buildSandpackFiles (que normaliza rutas y
 * añade archivos sintéticos solo para la vista previa). Así, al guardar,
 * reconstruimos el mismo formato '// === FILE: <path> ===' que ya
 * consumen sin problemas: parseBundle, el validador E2B, el export a
 * GitHub y el ZIP de descarga. Ninguno de esos consumidores ve nada
 * distinto a si el propio modelo hubiera escrito el código.
 */
import { useMemo, useRef, useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackFileExplorer,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { parseBundle, serializeBundle } from "@/lib/parseBundle";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, AlertTriangle } from "lucide-react";

interface AdminCodeEditorProps {
  appId: string;
  frontendCode: string;
  onSaved?: (newCode: string) => void;
}

// Convierte rutas reales ("src/App.tsx") a rutas Sandpack ("/src/App.tsx").
// Es un prefijo simple y reversible — NO es la normalización con pérdida
// de buildSandpackFiles, así que el viaje de ida y vuelta es exacto.
function toSandpackPath(realPath: string): string {
  return realPath.startsWith("/") ? realPath : `/${realPath}`;
}
function toRealPath(sandpackPath: string): string {
  return sandpackPath.startsWith("/") ? sandpackPath.slice(1) : sandpackPath;
}

function SaveBar({
  appId,
  originalRealPaths,
  onSaved,
}: {
  appId: string;
  originalRealPaths: string[];
  onSaved?: (newCode: string) => void;
}) {
  const { sandpack } = useSandpack();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // sandpack.files refleja el estado EN VIVO editado por el usuario,
      // incluyendo archivos nuevos que haya creado o eliminado desde el
      // explorador de archivos de Sandpack.
      const liveFiles = sandpack.files;
      const realFiles: Record<string, string> = {};
      for (const [sandpackPath, entry] of Object.entries(liveFiles)) {
        realFiles[toRealPath(sandpackPath)] = (entry as { code: string }).code;
      }
      const newBundle = serializeBundle(realFiles);

      const res = await fetch(`/api/apps/${appId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frontendCode: newBundle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Error ${res.status} al guardar`);
      }

      toast({
        title: "✅ Código guardado",
        description: "Maris AI ha actualizado el proyecto con tu edición manual. Redesplegando…",
      });
      onSaved?.(newBundle);
    } catch (err: any) {
      toast({
        title: "No se pudo guardar",
        description: err?.message ?? "Error desconocido al guardar el código.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-[#0b0e17] px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Editor de código completo — solo cuenta propietario. Los cambios sustituyen el código generado.
      </div>
      <Button
        onClick={handleSave}
        disabled={saving}
        size="sm"
        className="bg-emerald-600 text-white hover:bg-emerald-500"
      >
        {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
        Guardar cambios
      </Button>
    </div>
  );
}

export function AdminCodeEditor({ appId, frontendCode, onSaved }: AdminCodeEditorProps) {
  // Solo se recalcula si cambia el código base (p.ej. tras guardar o tras
  // una nueva generación) — evita que Sandpack se reinicialice en cada
  // repintado y el admin pierda ediciones no guardadas.
  const bundleKeyRef = useRef(frontendCode);
  const initialFiles = useMemo(() => {
    const real = parseBundle(frontendCode);
    const out: Record<string, string> = {};
    for (const [path, content] of Object.entries(real)) {
      out[toSandpackPath(path)] = content;
    }
    return out;
  }, [frontendCode]);

  const originalRealPaths = useMemo(() => Object.keys(parseBundle(frontendCode)), [frontendCode]);

  return (
    <div className="h-full flex flex-col">
      <SandpackProvider
        key={bundleKeyRef.current === frontendCode ? "stable" : frontendCode.slice(0, 40)}
        template="vite-react-ts"
        files={initialFiles}
        theme="dark"
        options={{ activeFile: initialFiles["/src/App.tsx"] ? "/src/App.tsx" : Object.keys(initialFiles)[0] }}
      >
        <SaveBar appId={appId} originalRealPaths={originalRealPaths} onSaved={onSaved} />
        <SandpackLayout style={{ height: "calc(100% - 41px)", borderRadius: 0, border: "none" }}>
          <SandpackFileExplorer style={{ height: "100%" }} />
          <SandpackCodeEditor
            style={{ height: "100%" }}
            showLineNumbers
            showInlineErrors
            wrapContent
            closableTabs
          />
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );
}
