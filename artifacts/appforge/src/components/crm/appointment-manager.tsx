import { useState } from "react";
import { Calendar, Clock, User, MapPin, Phone, Plus, Edit2, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Appointment {
  id: number;
  patient: string;
  date: string;
  time: string;
  type: string;
  status: "confirmed" | "pending" | "completed" | "cancelled";
  notes?: string;
}

export function AppointmentManager() {
  const [appointments, setAppointments] = useState<Appointment[]>([
    { id: 1, patient: "Elena Martínez", date: "2026-06-07", time: "09:00", type: "Sesión Manual", status: "confirmed" },
    { id: 2, patient: "Roberto Sanz", date: "2026-06-07", time: "10:30", type: "Evaluación Inicial", status: "confirmed" },
    { id: 3, patient: "Lucía Fernández", date: "2026-06-07", time: "12:00", type: "Punción Seca", status: "pending" },
    { id: 4, patient: "Carlos Ruiz", date: "2026-06-07", time: "16:00", type: "Rehabilitación", status: "confirmed" },
  ]);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Omit<Appointment, "id">>({
    patient: "",
    date: "",
    time: "",
    type: "Sesión Manual",
    status: "confirmed",
    notes: "",
  });

  const handleAddAppointment = () => {
    if (editingId) {
      setAppointments(appointments.map(a => a.id === editingId ? { ...a, ...formData } : a));
      setEditingId(null);
    } else {
      setAppointments([...appointments, { id: Math.max(...appointments.map(a => a.id), 0) + 1, ...formData }]);
    }
    setFormData({ patient: "", date: "", time: "", type: "Sesión Manual", status: "confirmed", notes: "" });
    setOpen(false);
  };

  const handleEdit = (apt: Appointment) => {
    setFormData(apt);
    setEditingId(apt.id);
    setOpen(true);
  };

  const handleDelete = (id: number) => {
    setAppointments(appointments.filter(a => a.id !== id));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "confirmed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "pending": return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case "completed": return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      case "cancelled": return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return null;
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      confirmed: "Confirmada",
      pending: "Pendiente",
      completed: "Completada",
      cancelled: "Cancelada",
    };
    return labels[status] || status;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Gestión de Citas</h2>
          <p className="text-muted-foreground">Administra el calendario de tu consulta</p>
        </div>
        <Button onClick={() => { setEditingId(null); setFormData({ patient: "", date: "", time: "", type: "Sesión Manual", status: "confirmed", notes: "" }); setOpen(true); }} className="bg-primary hover:bg-primary/90">
          <Plus className="mr-2 h-4 w-4" /> Nueva Cita
        </Button>
      </div>

      <div className="grid gap-4">
        {appointments.map((apt) => (
          <Card key={apt.id} className="bg-[#0f0f12] border-white/10 hover:border-white/20 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-lg">{apt.patient}</span>
                    <Badge variant="secondary" className="bg-primary/20 text-primary hover:bg-primary/30 border-0">
                      {apt.type}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {new Date(apt.date).toLocaleDateString('es-ES')}
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {apt.time}
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(apt.status)}
                      <span className="text-muted-foreground">{getStatusLabel(apt.status)}</span>
                    </div>
                  </div>
                  {apt.notes && <p className="text-sm text-muted-foreground italic">Notas: {apt.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="hover:bg-white/10"
                    onClick={() => handleEdit(apt)}
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="hover:bg-red-500/10 text-red-500"
                    onClick={() => handleDelete(apt.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#0f0f12] border-white/10">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Cita" : "Nueva Cita"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Paciente</Label>
              <Input 
                value={formData.patient}
                onChange={(e) => setFormData({ ...formData, patient: e.target.value })}
                placeholder="Nombre del paciente"
                className="bg-white/5 border-white/10 mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Fecha</Label>
                <Input 
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="bg-white/5 border-white/10 mt-1"
                />
              </div>
              <div>
                <Label className="text-muted-foreground">Hora</Label>
                <Input 
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className="bg-white/5 border-white/10 mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground">Tipo de Sesión</Label>
              <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                <SelectTrigger className="bg-white/5 border-white/10 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#18181b] border-white/10">
                  <SelectItem value="Sesión Manual">Sesión Manual</SelectItem>
                  <SelectItem value="Evaluación Inicial">Evaluación Inicial</SelectItem>
                  <SelectItem value="Punción Seca">Punción Seca</SelectItem>
                  <SelectItem value="Rehabilitación">Rehabilitación</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground">Estado</Label>
              <Select value={formData.status} onValueChange={(value: any) => setFormData({ ...formData, status: value })}>
                <SelectTrigger className="bg-white/5 border-white/10 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#18181b] border-white/10">
                  <SelectItem value="confirmed">Confirmada</SelectItem>
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="completed">Completada</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground">Notas</Label>
              <Textarea 
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notas adicionales..."
                className="bg-white/5 border-white/10 mt-1 resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-white/10">Cancelar</Button>
            <Button onClick={handleAddAppointment} className="bg-primary hover:bg-primary/90">
              {editingId ? "Actualizar" : "Crear"} Cita
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
