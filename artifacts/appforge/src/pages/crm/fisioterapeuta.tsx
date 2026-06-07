import { useState } from "react";
import { 
  Users, 
  Calendar, 
  Clock, 
  FileText, 
  TrendingUp, 
  Plus, 
  Search, 
  MoreVertical,
  ChevronRight,
  Activity,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Settings,
  Bell
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PatientDetailModal } from "@/components/crm/patient-detail-modal";
import { AppointmentManager } from "@/components/crm/appointment-manager";
import { AnalyticsDashboard } from "@/components/crm/analytics-dashboard";

export default function FisioterapeutaCRM() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const stats = [
    { title: "Pacientes Totales", value: "124", icon: Users, color: "text-blue-500", trend: "+12% este mes" },
    { title: "Citas Hoy", value: "8", icon: Calendar, color: "text-purple-500", trend: "2 urgencias" },
    { title: "Tratamientos Activos", value: "45", icon: Activity, color: "text-emerald-500", trend: "95% efectividad" },
    { title: "Ingresos Mes", value: "4.250€", icon: TrendingUp, color: "text-amber-500", trend: "+18% vs mes anterior" },
  ];

  const patients = [
    { id: 1, name: "Alejandro López", status: "Activo", lastVisit: "Hace 2 días", condition: "Lumbalgia crónica", progress: 75 },
    { id: 2, name: "María García", status: "Pendiente", lastVisit: "Hace 1 semana", condition: "Esguince de tobillo", progress: 30 },
    { id: 3, name: "Juan Pérez", status: "Finalizado", lastVisit: "Hace 1 mes", condition: "Rehabilitación post-quirúrgica", progress: 100 },
    { id: 4, name: "Elena Martínez", status: "Activo", lastVisit: "Hoy", condition: "Cervicalgia", progress: 60 },
  ];

  const handlePatientClick = (patient: any) => {
    setSelectedPatient(patient);
    setModalOpen(true);
  };

  return (
    <div className="flex flex-col gap-8 p-8 bg-[#09090b] min-h-screen text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-primary/20 p-3 rounded-2xl">
            <Activity className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Panel CRM Fisioterapia</h1>
            <p className="text-muted-foreground">Gestiona tus pacientes, citas y tratamientos desde un solo lugar.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10 relative">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-1 -right-1 h-2 w-2 bg-primary rounded-full"></span>
          </Button>
          <Button variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10">
            <Settings className="h-4 w-4" />
          </Button>
          <Button className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20">
            <UserPlus className="mr-2 h-4 w-4" /> Nuevo Paciente
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full space-y-8">
        <TabsList className="bg-[#0f0f12] border border-white/10 p-1 inline-flex w-auto">
          <TabsTrigger value="overview" className="data-[state=active]:bg-primary">Vista General</TabsTrigger>
          <TabsTrigger value="appointments" className="data-[state=active]:bg-primary">Agenda</TabsTrigger>
          <TabsTrigger value="analytics" className="data-[state=active]:bg-primary">Análisis</TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-primary">Configuración</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 mt-0">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat, i) => (
              <Card key={i} className="bg-[#0f0f12] border-white/10 hover:border-white/20 transition-all cursor-default group">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground group-hover:text-white transition-colors">{stat.title}</CardTitle>
                  <stat.icon className={`h-4 w-4 ${stat.color} group-hover:scale-110 transition-transform`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stat.trend}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Patients Table */}
            <Card className="lg:col-span-2 bg-[#0f0f12] border-white/10">
              <CardHeader>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <CardTitle>Listado de Pacientes</CardTitle>
                    <CardDescription>Seguimiento detallado de tratamientos y evolución.</CardDescription>
                  </div>
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Buscar paciente..." 
                      className="pl-8 bg-white/5 border-white/10 focus:ring-primary"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader className="border-white/10">
                    <TableRow className="hover:bg-transparent border-white/10">
                      <TableHead className="text-muted-foreground">Paciente</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                      <TableHead className="text-muted-foreground">Condición</TableHead>
                      <TableHead className="text-muted-foreground">Progreso</TableHead>
                      <TableHead className="text-right text-muted-foreground">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patients.map((patient) => (
                      <TableRow 
                        key={patient.id} 
                        className="border-white/10 hover:bg-white/5 transition-colors cursor-pointer"
                        onClick={() => handlePatientClick(patient)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 border border-white/10">
                              <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                {patient.name.split(' ').map(n => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span>{patient.name}</span>
                              <span className="text-xs text-muted-foreground">{patient.lastVisit}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={patient.status === "Activo" ? "default" : "secondary"} className={
                            patient.status === "Activo" ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-0" : 
                            patient.status === "Pendiente" ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-0" :
                            "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-0"
                          }>
                            {patient.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{patient.condition}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-full bg-white/10 rounded-full h-1.5">
                              <div 
                                className="bg-primary h-1.5 rounded-full" 
                                style={{ width: `${patient.progress}%` }}
                              ></div>
                            </div>
                            <span className="text-xs text-muted-foreground">{patient.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="hover:bg-white/10" onClick={(e) => { e.stopPropagation(); handlePatientClick(patient); }}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Quick Agenda */}
            <Card className="bg-[#0f0f12] border-white/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Próximas Citas
                </CardTitle>
                <CardDescription>Agenda para el día de hoy.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {[
                    { time: "09:00", patient: "Elena Martínez", type: "Sesión Manual", status: "Confirmada" },
                    { time: "10:30", patient: "Roberto Sanz", type: "Evaluación Inicial", status: "Confirmada" },
                    { time: "12:00", patient: "Lucía Fernández", type: "Punción Seca", status: "Pendiente" },
                    { time: "16:00", patient: "Carlos Ruiz", type: "Rehabilitación", status: "Confirmada" },
                  ].map((apt, i) => (
                    <div key={i} className="flex items-start gap-4 relative">
                      <div className="text-sm font-bold text-primary w-12 pt-1">{apt.time}</div>
                      <div className="flex-1 space-y-1 pb-4 border-b border-white/5 last:border-0">
                        <div className="flex justify-between items-center">
                          <p className="text-sm font-medium">{apt.patient}</p>
                          {apt.status === "Confirmada" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{apt.type}</p>
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" className="w-full border-white/10 bg-white/5 hover:bg-white/10 mt-4">
                    Ver Agenda Completa <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="appointments" className="mt-0">
          <Card className="bg-[#0f0f12] border-white/10">
            <CardContent className="p-6">
              <AppointmentManager />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <Card className="bg-[#0f0f12] border-white/10">
            <CardContent className="p-6">
              <AnalyticsDashboard />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Patient Modal */}
      <PatientDetailModal 
        open={modalOpen} 
        onOpenChange={setModalOpen} 
        patient={selectedPatient} 
      />
    </div>
  );
}
