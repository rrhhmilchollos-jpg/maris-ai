import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Ticket {
  _id: string;
  userId: string;
  userEmail?: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'closed';
  responses: Array<{
    senderId: string;
    message: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function AdminTicketsPanel() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [newStatus, setNewStatus] = useState<'open' | 'in_progress' | 'closed'>('open');
  const [isResponding, setIsResponding] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    loadTickets();
  }, []);

  const loadTickets = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/tickets", {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Error al cargar tickets");
      const data = await response.json();
      setTickets(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar los tickets",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRespond = async () => {
    if (!selectedTicket || !responseMessage.trim()) {
      toast({
        title: "Error",
        description: "Por favor escribe una respuesta",
        variant: "destructive",
      });
      return;
    }

    setIsResponding(true);
    try {
      const response = await fetch(`/api/admin/tickets/${selectedTicket._id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: responseMessage,
          newStatus,
        }),
      });
      if (!response.ok) throw new Error("Error al responder ticket");

      toast({
        title: "Éxito",
        description: "Respuesta enviada al usuario",
      });

      setResponseMessage("");
      await loadTickets();
      if (selectedTicket) {
        const updatedTicket = await fetch(`/api/admin/tickets`).then(r => r.json());
        const updated = updatedTicket.find((t: Ticket) => t._id === selectedTicket._id);
        setSelectedTicket(updated || null);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo enviar la respuesta",
        variant: "destructive",
      });
    } finally {
      setIsResponding(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'in_progress': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'closed': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open': return 'Abierto';
      case 'in_progress': return 'En proceso';
      case 'closed': return 'Cerrado';
      default: return status;
    }
  };

  const filteredTickets = filterStatus === "all" 
    ? tickets 
    : tickets.filter(t => t.status === filterStatus);

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <MessageSquare className="h-5 w-5 text-primary mr-2" />
            Gestión de Tickets de Soporte
          </CardTitle>
          <CardDescription>
            Responde a los tickets de los usuarios sobre pagos, reembolsos y reclamaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-center flex-wrap">
            <Button
              onClick={loadTickets}
              variant="outline"
              disabled={isLoading}
              size="sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4 mr-2" />
              )}
              Actualizar ({filteredTickets.length})
            </Button>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40 h-9 text-xs">
                <SelectValue placeholder="Filtrar por estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Abiertos</SelectItem>
                <SelectItem value="in_progress">En proceso</SelectItem>
                <SelectItem value="closed">Cerrados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Lista de tickets */}
            <div className="lg:col-span-1 space-y-2 max-h-96 overflow-y-auto border border-white/10 rounded-lg p-3 bg-background/50">
              {filteredTickets.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No hay tickets en este estado</p>
                </div>
              ) : (
                filteredTickets.map((ticket) => (
                  <div
                    key={ticket._id}
                    onClick={() => setSelectedTicket(ticket)}
                    className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                      selectedTicket?._id === ticket._id
                        ? "border-primary/50 bg-primary/10"
                        : "border-white/10 bg-background/30 hover:bg-background/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground truncate">{ticket.userEmail}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                      <Badge className={`flex-shrink-0 border text-xs ${getStatusColor(ticket.status)}`}>
                        {getStatusLabel(ticket.status)}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Detalle del ticket seleccionado */}
            {selectedTicket && (
              <div className="lg:col-span-2 space-y-4 border border-white/10 rounded-lg p-4 bg-background/50">
                <div>
                  <h3 className="text-lg font-semibold mb-2">{selectedTicket.subject}</h3>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-muted-foreground">De: {selectedTicket.userEmail}</p>
                    <Badge className={`border ${getStatusColor(selectedTicket.status)}`}>
                      {getStatusLabel(selectedTicket.status)}
                    </Badge>
                  </div>
                  <div className="bg-background/50 rounded p-3 border border-white/5 mb-4">
                    <p className="text-sm text-muted-foreground">{selectedTicket.message}</p>
                  </div>
                </div>

                {/* Respuestas anteriores */}
                {selectedTicket.responses.length > 0 && (
                  <div className="space-y-2 pt-4 border-t border-white/10">
                    <p className="text-sm font-medium text-primary">Historial de respuestas:</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTicket.responses.map((response, idx) => (
                        <div key={idx} className="bg-primary/5 rounded p-3 border border-primary/20">
                          <p className="text-xs font-medium text-primary mb-1">
                            {response.senderId === 'admin' ? '🛠️ Soporte Maris AI' : '👤 Usuario'}
                          </p>
                          <p className="text-xs text-muted-foreground mb-1">{response.message}</p>
                          <p className="text-[10px] text-muted-foreground/50">
                            {formatDistanceToNow(new Date(response.createdAt), { addSuffix: true, locale: es })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Formulario de respuesta */}
                {selectedTicket.status !== 'closed' && (
                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        Tu respuesta
                      </label>
                      <Textarea
                        value={responseMessage}
                        onChange={(e) => setResponseMessage(e.target.value)}
                        placeholder="Escribe tu respuesta aquí..."
                        className="min-h-[100px] bg-background/50 border-border/50 text-sm"
                        disabled={isResponding}
                      />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-muted-foreground mb-2 block">
                        Cambiar estado
                      </label>
                      <Select
                        value={newStatus}
                        onValueChange={(value) => setNewStatus(value as 'open' | 'in_progress' | 'closed')}
                        disabled={isResponding}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Abierto</SelectItem>
                          <SelectItem value="in_progress">En proceso</SelectItem>
                          <SelectItem value="closed">Cerrado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleRespond}
                      disabled={isResponding || !responseMessage.trim()}
                      className="w-full bg-primary text-white hover:bg-primary/90"
                    >
                      {isResponding ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar respuesta
                    </Button>
                  </div>
                )}

                {selectedTicket.status === 'closed' && (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-400">
                    ✓ Este ticket está cerrado
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
