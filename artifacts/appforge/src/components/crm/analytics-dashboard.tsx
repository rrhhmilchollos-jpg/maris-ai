import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Users, DollarSign, Calendar } from "lucide-react";

const monthlyData = [
  { month: "Ene", ingresos: 2400, sesiones: 12, pacientes: 8 },
  { month: "Feb", ingresos: 2800, sesiones: 14, pacientes: 10 },
  { month: "Mar", ingresos: 3200, sesiones: 16, pacientes: 12 },
  { month: "Abr", ingresos: 3600, sesiones: 18, pacientes: 14 },
  { month: "May", ingresos: 4000, sesiones: 20, pacientes: 16 },
  { month: "Jun", ingresos: 4250, sesiones: 21, pacientes: 18 },
];

const treatmentTypes = [
  { name: "Sesión Manual", value: 35, color: "#a855f7" },
  { name: "Punción Seca", value: 25, color: "#06b6d4" },
  { name: "Rehabilitación", value: 20, color: "#10b981" },
  { name: "Evaluación", value: 20, color: "#f59e0b" },
];

const patientStatus = [
  { status: "Activo", count: 45, color: "#10b981" },
  { status: "En Pausa", count: 12, color: "#f59e0b" },
  { status: "Finalizado", count: 67, color: "#6366f1" },
];

export function AnalyticsDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Análisis y Reportes</h2>
        <p className="text-muted-foreground">Visualiza el desempeño de tu consulta</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0f0f12] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ingresos Mes</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">€4.250</div>
            <p className="text-xs text-emerald-500 mt-1">+18% vs mes anterior</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f12] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Sesiones Completadas</CardTitle>
            <Calendar className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">156</div>
            <p className="text-xs text-muted-foreground mt-1">En los últimos 6 meses</p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f12] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tasa Retención</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">87%</div>
            <p className="text-xs text-muted-foreground mt-1">Pacientes activos vs totales</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0f0f12] border-white/10">
        <CardHeader>
          <CardTitle>Ingresos y Sesiones por Mes</CardTitle>
          <CardDescription>Tendencia de ingresos y número de sesiones realizadas</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }} />
              <Legend />
              <Line type="monotone" dataKey="ingresos" stroke="#a855f7" strokeWidth={2} name="Ingresos (€)" />
              <Line type="monotone" dataKey="sesiones" stroke="#06b6d4" strokeWidth={2} name="Sesiones" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-[#0f0f12] border-white/10">
          <CardHeader>
            <CardTitle>Distribución por Tipo de Tratamiento</CardTitle>
            <CardDescription>Porcentaje de sesiones por tipo</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={treatmentTypes} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value}%`} outerRadius={80} fill="#8884d8" dataKey="value">
                  {treatmentTypes.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f12] border-white/10">
          <CardHeader>
            <CardTitle>Estado de Pacientes</CardTitle>
            <CardDescription>Clasificación de pacientes por estado</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={patientStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="status" stroke="rgba(255,255,255,0.5)" />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }} />
                <Bar dataKey="count" fill="#a855f7" radius={[8, 8, 0, 0]}>
                  {patientStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0f0f12] border-white/10">
        <CardHeader>
          <CardTitle>Evolución de Pacientes Activos</CardTitle>
          <CardDescription>Crecimiento mensual de la base de pacientes</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid rgba(255,255,255,0.1)" }} />
              <Legend />
              <Bar dataKey="pacientes" fill="#10b981" radius={[8, 8, 0, 0]} name="Pacientes Nuevos" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
