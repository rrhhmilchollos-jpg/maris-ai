import { useState } from "react";
import { X, Plus, Calendar, FileText, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PatientDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient?: any;
}

export function PatientDetailModal({ open, onOpenChange, patient }: PatientDetailModalProps) {
  const [activeTab, setActiveTab] = useState("general");

  if (!patient) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[#0f0f12] border-white/10">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{patient.name}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-[#18181b] border border-white/10">
            <TabsTrigger value="general" className="data-[state=active]:bg-primary">General</TabsTrigger>
            <TabsTrigger value="clinical" className="data-[state=active]:bg-primary">Clínico</TabsTrigger>
            <TabsTrigger value="appointments" className="data-[state=active]:bg-primary">Citas</TabsTrigger>
            <TabsTrigger value="billing" className="data-[state=active]:bg-primary">Facturación</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Teléfono</Label>
                <Input value="+34 612 345 678" className="bg-white/5 border-white/10 mt-1" readOnly />
              </div>
              <div>
                <Label className="text-muted-foreground">Email</Label>
                <Input value="patient@example.com" className="bg-white/5 border-white/10 mt-1" readOnly />
              </div>
              <div>
                <Label className="text-muted-foreground">Edad</Label>
                <Input value="42 años" className="bg-white/5 border-white/10 mt-1" readOnly />
              </div>
              <div>
                <Label className="text-muted-foreground">Género</Label>
                <Input value="Masculino" className="bg-white/5 border-white/10 mt-1" readOnly />
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Notas Generales</Label>
              <Textarea placeholder="Notas sobre el paciente..." className="bg-white/5 border-white/10 mt-1 resize-none" rows={4} />
            </div>
          </TabsContent>

          <TabsContent value="clinical" className="space-y-4 mt-4">
            <Card className="bg-[#18181b] border-white/10">
              <CardHeader>
                <CardTitle className="text-sm">Diagnóstico Principal</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border-0">{patient.condition}</Badge>
              </CardContent>
            </Card>

            <Card className="bg-[#18181b] border-white/10">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Historial de Tratamientos</CardTitle>
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  <Plus className="h-3 w-3 mr-1" /> Nuevo
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="border-l-2 border-primary pl-4 py-2">
                  <p className="text-sm font-medium">Sesión Manual - 2 de junio</p>
                  <p className="text-xs text-muted-foreground">Masaje terapéutico y estiramientos</p>
                </div>
                <div className="border-l-2 border-emerald-500 pl-4 py-2">
                  <p className="text-sm font-medium">Evaluación Inicial - 1 de junio</p>
                  <p className="text-xs text-muted-foreground">Pruebas de movilidad y fuerza</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appointments" className="space-y-4 mt-4">
            <Card className="bg-[#18181b] border-white/10">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4" /> Próximas Citas
                </CardTitle>
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  <Plus className="h-3 w-3 mr-1" /> Agendar
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-white/5 rounded-lg border border-white/10">
                  <div>
                    <p className="text-sm font-medium">Sesión Manual</p>
                    <p className="text-xs text-muted-foreground">Jueves, 9 de junio - 10:30</p>
                  </div>
                  <Badge className="bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 border-0">Confirmada</Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="billing" className="space-y-4 mt-4">
            <Card className="bg-[#18181b] border-white/10">
              <CardHeader>
                <CardTitle className="text-sm">Resumen de Facturación</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Sesiones Completadas:</span>
                  <span className="font-medium">12</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Monto Total:</span>
                  <span className="font-medium text-primary">€480.00</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Pagado:</span>
                  <span className="font-medium text-emerald-500">€480.00</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10">Cerrar</Button>
          <Button className="bg-primary hover:bg-primary/90">Guardar Cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
