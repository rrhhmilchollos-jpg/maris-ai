import { useState } from "react";
import { useLocation } from "wouter";
import { 
  useGetApp, 
  useDeleteApp, 
  getGetAppQueryKey, 
  getListAppsQueryKey, 
  getGetMyStatsQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { 
  ArrowLeft, 
  Trash2, 
  Copy, 
  Check, 
  FileCode2, 
  TerminalSquare, 
  Layers,
  Calendar
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function AppDetailPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<"frontend" | "backend">("frontend");
  const [copied, setCopied] = useState(false);

  const { data: app, isLoading } = useGetApp(id, { 
    query: { enabled: !!id, queryKey: getGetAppQueryKey(id) } 
  });

  const deleteMutation = useDeleteApp({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        toast({ title: "App eliminada", description: "La aplicación se eliminó de forma permanente." });
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        toast({ title: "No se pudo eliminar", description: err.message, variant: "destructive" });
      }
    }
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Copiado al portapapeles", duration: 2000 });
  };

  const currentCode = app ? (activeTab === "frontend" ? app.frontendCode : app.backendCode) : "";

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <Button 
          variant="ghost" 
          size="sm" 
          className="mb-4 text-muted-foreground hover:text-foreground"
          onClick={() => setLocation("/dashboard")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver al panel
        </Button>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-12 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-4">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-[600px] w-full" />
          </div>
        ) : app ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-140px)] min-h-[600px]">
            {/* Información lateral */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground mb-2 break-words">{app.title}</h1>
                <p className="text-muted-foreground text-sm mb-4 leading-relaxed">{app.description}</p>
                
                <div className="flex flex-wrap gap-2 mb-6">
                  {app.techStack?.map(tech => (
                    <Badge key={tech} variant="secondary" className="font-mono text-xs bg-secondary/50">
                      {tech}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary">
                    {app.status}
                  </Badge>
                </div>

                <div className="space-y-3 text-sm border-t border-white/10 pt-4">
                  <div className="flex items-center text-muted-foreground">
                    <Calendar className="h-4 w-4 mr-2 opacity-70" />
                    <span>Creada el {format(new Date(app.createdAt), "d MMM yyyy", { locale: es })}</span>
                  </div>
                  <div className="flex items-start text-muted-foreground">
                    <TerminalSquare className="h-4 w-4 mr-2 opacity-70 mt-0.5 flex-shrink-0" />
                    <div className="bg-black/40 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground/80 overflow-hidden text-ellipsis line-clamp-3">
                      {app.prompt}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-6 border-t border-white/10">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-destructive/20">
                      <Trash2 className="h-4 w-4 mr-2" /> Eliminar app
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="border-destructive/20">
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar esta aplicación?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta acción no se puede deshacer. Se borrarán de forma permanente el código y los datos de "{app.title}".
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => deleteMutation.mutate({ id: app.id })}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Eliminar definitivamente
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>

            {/* Visor de código */}
            <div className="lg:col-span-3 flex flex-col bg-[#0d0d12] rounded-xl border border-white/10 overflow-hidden shadow-2xl relative">
              <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none"></div>
              
              <div className="flex items-center justify-between px-4 py-3 bg-[#111118] border-b border-white/5 relative z-10">
                <div className="flex space-x-1">
                  <Button 
                    variant={activeTab === "frontend" ? "secondary" : "ghost"} 
                    size="sm" 
                    onClick={() => setActiveTab("frontend")}
                    className={`h-8 rounded-md ${activeTab === "frontend" ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/5'}`}
                  >
                    <Layers className="h-4 w-4 mr-2" /> Frontend React
                  </Button>
                  <Button 
                    variant={activeTab === "backend" ? "secondary" : "ghost"} 
                    size="sm" 
                    onClick={() => setActiveTab("backend")}
                    className={`h-8 rounded-md ${activeTab === "backend" ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white hover:bg-white/5'}`}
                  >
                    <FileCode2 className="h-4 w-4 mr-2" /> Backend API
                  </Button>
                </div>
                <div className="flex space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => copyToClipboard(currentCode)}
                    className="h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
                  >
                    {copied ? <Check className="h-4 w-4 mr-2 text-green-400" /> : <Copy className="h-4 w-4 mr-2" />}
                    {copied ? "¡Copiado!" : "Copiar código"}
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-auto relative z-10 p-4">
                <pre className="font-mono text-sm text-[#e2e2e3] leading-relaxed break-pre">
                  <code>{currentCode || "// Aún no hay código generado para esta sección."}</code>
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <h2 className="text-2xl font-bold text-muted-foreground">No encontramos esta aplicación</h2>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/dashboard")}>Volver al panel</Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
