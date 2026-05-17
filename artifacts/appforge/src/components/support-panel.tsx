import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, AlertCircle, CheckCircle2, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Ticket {
  _id: string;
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

export function SupportPanel() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const loadTickets = async () => {
    setIsLoadingTickets(true);
    try {
      const response = await fetch("/api/tickets", {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Error al cargar tickets");
      const data = await response.json();
      setTickets(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar tus tickets",
        variant: "destructive",
      });
    } finally {
      setIsLoadingTickets(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast({
        title: "Campos vacíos",
        description: "Por favor completa el asunto y el mensaje",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      if (!response.ok) throw new Error("Error al crear ticket");
      
      toast({
        title: "Ticket creado",
        description: "Tu solicitud ha sido enviada. Pronto nos pondremos en contacto.",
      });
      
      setSubject("");
      setMessage("");
      setShowForm(false);
      await loadTickets();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo crear el ticket",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
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

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-card/60 backdrop-blur shadow-lg overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-accent"></div>
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <MessageSquare className="h-5 w-5 text-primary mr-2" />
            Centro de soporte
          </CardTitle>
          <CardDescription>
            ¿Problemas con pagos, reembolsos o reclamaciones? Contáctanos aquí.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showForm && (
            <div className="flex gap-2">
              <Button
                onClick={() => setShowForm(true)}
                className="bg-primary text-white hover:bg-primary/90"
              >
                <Send className="h-4 w-4 mr-2" />
                Nuevo ticket
              </Button>
              <Button
                onClick={loadTickets}
                variant="outline"
                disabled={isLoadingTickets}
              >
                {isLoadingTickets ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4 mr-2" />
                )}
                Mis tickets ({tickets.length})
              </Button>
            </div>
          )}

          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-4 border border-white/10 rounded-lg p-4 bg-background/50">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Asunto
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="ej. Problema con pago de créditos"
                  className="bg-background/50 border-border/50"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Mensaje
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe tu problema en detalle..."
                  className="min-h-[120px] bg-background/50 border-border/50"
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-primary text-white hover:bg-primary/90"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Enviar ticket
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {tickets.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Tus tickets</h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tickets.map((ticket) => (
                  <div
                    key={ticket._id}
                    onClick={() => setSelectedTicket(selectedTicket?._id === ticket._id ? null : ticket)}
                    className="p-3 rounded-lg border border-white/10 bg-background/50 hover:bg-background/70 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true, locale: es })}
                        </p>
                      </div>
                      <Badge className={`flex-shrink-0 border ${getStatusColor(ticket.status)}`}>
                        {getStatusLabel(ticket.status)}
                      </Badge>
                    </div>

                    {selectedTicket?._id === ticket._id && (
                      <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                        <p className="text-sm text-muted-foreground">{ticket.message}</p>
                        {ticket.responses.length > 0 && (
                          <div className="space-y-2 mt-3 pt-3 border-t border-white/10">
                            <p className="text-xs font-medium text-primary">Respuestas:</p>
                            {ticket.responses.map((response, idx) => (
                              <div key={idx} className="bg-primary/5 rounded p-2 border border-primary/20">
                                <p className="text-xs font-medium text-primary mb-1">
                                  {response.senderId === 'admin' ? '🛠️ Soporte Maris AI' : 'Tú'}
                                </p>
                                <p className="text-xs text-muted-foreground">{response.message}</p>
                                <p className="text-[10px] text-muted-foreground/50 mt-1">
                                  {formatDistanceToNow(new Date(response.createdAt), { addSuffix: true, locale: es })}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
