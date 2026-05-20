import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, MessageSquare, X } from "lucide-react";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    loadTickets();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [selectedTicket?.responses]);

  const loadTickets = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/tickets", {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Error al cargar tickets");
      const data = await response.json();
      setTickets(data);
      // Si hay un ticket seleccionado, actualizar su contenido
      if (selectedTicket) {
        const updated = data.find((t: Ticket) => t._id === selectedTicket._id);
        if (updated) {
          setSelectedTicket(updated);
          setNewStatus(updated.status);
        }
      }
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

      const updatedTicket = await response.json();
      setSelectedTicket(updatedTicket);
      setResponseMessage("");

      toast({
        title: "Éxito",
        description: "Respuesta enviada al usuario",
      });

      await loadTickets();
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
          {!selectedTicket ? (
            <>
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

              {/* Lista de tickets */}
              <div className="space-y-2 max-h-96 overflow-y-auto border border-white/10 rounded-lg p-3 bg-background/50">
                {filteredTickets.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No hay tickets en este estado</p>
                  </div>
                ) : (
                  filteredTickets.map((ticket) => (
                    <div
                      key={ticket._id}
                      onClick={() => {
                        setSelectedTicket(ticket);
                        setNewStatus(ticket.status);
                      }}
                      className="p-3 rounded-lg border border-white/10 bg-background/30 hover:bg-background/50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{ticket.subject}</p>
                          <p className="text-xs text-muted-foreground truncate">{ticket.userEmail}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true, locale: es })}
                          </p>
                          {ticket.responses.length > 0 && (
                            <p className="text-xs text-primary/70 mt-1">
                              {ticket.responses.length} {ticket.responses.length === 1 ? 'respuesta' : 'respuestas'}
                            </p>
                          )}
                        </div>
                        <Badge className={`flex-shrink-0 border text-xs ${getStatusColor(ticket.status)}`}>
                          {getStatusLabel(ticket.status)}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            // Vista de conversación del ticket
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{selectedTicket.subject}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    De: {selectedTicket.userEmail}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Creado {formatDistanceToNow(new Date(selectedTicket.createdAt), { addSuffix: true, locale: es })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`border ${getStatusColor(selectedTicket.status)}`}>
                    {getStatusLabel(selectedTicket.status)}
                  </Badge>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Historial de mensajes */}
              <div className="flex-1 overflow-y-auto space-y-3 min-h-[300px] max-h-[500px] pr-2 custom-scrollbar">
                {/* Mensaje inicial del usuario */}
                <div className="flex justify-start">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 max-w-xs">
                    <p className="text-xs font-medium text-blue-400 mb-1">👤 {selectedTicket.userEmail}</p>
                    <p className="text-sm text-white">{selectedTicket.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(selectedTicket.createdAt), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                </div>

                {/* Respuestas */}
                {selectedTicket.responses.map((response, idx) => {
                  const isAdminMessage = response.senderId !== selectedTicket.userId;
                  return (
                    <div key={idx} className={`flex ${isAdminMessage ? 'justify-end' : 'justify-start'}`}>
                      <div className={`rounded-lg p-3 max-w-xs ${
                        isAdminMessage
                          ? 'bg-green-500/10 border border-green-500/30'
                          : 'bg-blue-500/10 border border-blue-500/30'
                      }`}>
                        <p className={`text-xs font-medium mb-1 ${
                          isAdminMessage ? 'text-green-400' : 'text-blue-400'
                        }`}>
                          {isAdminMessage ? '🛠️ Soporte Maris AI' : `👤 ${selectedTicket.userEmail}`}
                        </p>
                        <p className="text-sm text-white">{response.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(response.createdAt), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Formulario de respuesta */}
              {selectedTicket.status !== 'closed' && (
                <div className="space-y-3 pt-3 border-t border-white/10">
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

                  <div className="flex gap-2">
                    <Button
                      onClick={handleRespond}
                      disabled={isResponding || !responseMessage.trim()}
                      className="flex-1 bg-primary text-white hover:bg-primary/90"
                    >
                      {isResponding ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar respuesta
                    </Button>
                    <Button
                      onClick={() => setSelectedTicket(null)}
                      variant="outline"
                      disabled={isResponding}
                    >
                      Volver
                    </Button>
                  </div>
                </div>
              )}

              {selectedTicket.status === 'closed' && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-400">
                  ✓ Este ticket está cerrado. No se pueden enviar más mensajes.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
