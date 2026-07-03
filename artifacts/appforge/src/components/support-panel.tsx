import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, AlertCircle, CheckCircle2, MessageSquare, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Ticket {
  _id: string;
  userId: string;
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
  const [replyMessage, setReplyMessage] = useState("");
  const [isReplySubmitting, setIsReplySubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [selectedTicket?.responses]);

  const loadTickets = async () => {
    setIsLoadingTickets(true);
    try {
      const data = await apiFetch<Ticket[]>("/api/tickets");
      setTickets(Array.isArray(data) ? data : []);
      // Si hay un ticket seleccionado, actualizar su contenido
      if (selectedTicket) {
        const updated = data.find((t: Ticket) => t._id === selectedTicket._id);
        if (updated) setSelectedTicket(updated);
      }
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
      await apiFetch<Ticket>("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      
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

  const handleReply = async () => {
    if (!selectedTicket || !replyMessage.trim()) {
      toast({
        title: "Error",
        description: "Por favor escribe un mensaje",
        variant: "destructive",
      });
      return;
    }

    setIsReplySubmitting(true);
    try {
      const updatedTicket = await apiFetch<Ticket>(`/api/tickets/${selectedTicket._id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyMessage }),
      });
      setSelectedTicket(updatedTicket);
      setReplyMessage("");
      
      toast({
        title: "Respuesta enviada",
        description: "Tu mensaje ha sido enviado al equipo de soporte.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo enviar la respuesta",
        variant: "destructive",
      });
    } finally {
      setIsReplySubmitting(false);
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

  const isTicketClosed = selectedTicket?.status === 'closed';

  return (
    <>
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
          {!selectedTicket ? (
            <>
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
                        onClick={() => setSelectedTicket(ticket)}
                        className="p-3 rounded-lg border border-white/10 bg-background/50 hover:bg-background/70 cursor-pointer transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{ticket.subject}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true, locale: es })}
                            </p>
                            {ticket.responses.length > 0 && (
                              <p className="text-xs text-primary/70 mt-1">
                                {ticket.responses.length} {ticket.responses.length === 1 ? 'respuesta' : 'respuestas'}
                              </p>
                            )}
                          </div>
                          <Badge className={`flex-shrink-0 border ${getStatusColor(ticket.status)}`}>
                            {getStatusLabel(ticket.status)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            // Vista de conversación del ticket
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{selectedTicket.subject}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
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
              <div className="flex-1 overflow-y-auto space-y-3 min-h-[300px] max-h-[400px] pr-2">
                {/* Mensaje inicial del usuario */}
                <div className="flex justify-end">
                  <div className="bg-primary/20 border border-primary/30 rounded-lg p-3 max-w-xs">
                    <p className="text-xs font-medium text-primary mb-1">Tú</p>
                    <p className="text-sm text-white">{selectedTicket.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(selectedTicket.createdAt), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                </div>

                {/* Respuestas */}
                {selectedTicket.responses.map((response, idx) => {
                  const isUserMessage = response.senderId === selectedTicket.userId;
                  return (
                    <div key={idx} className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}>
                      <div className={`rounded-lg p-3 max-w-xs ${
                        isUserMessage
                          ? 'bg-primary/20 border border-primary/30'
                          : 'bg-accent/20 border border-accent/30'
                      }`}>
                        <p className={`text-xs font-medium mb-1 ${
                          isUserMessage ? 'text-primary' : 'text-accent'
                        }`}>
                          {isUserMessage ? 'Tú' : '🛠️ Soporte Maris AI'}
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
              {!isTicketClosed && (
                <div className="space-y-2 pt-3 border-t border-white/10">
                  <div>
                    <Textarea
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder="Escribe tu respuesta aquí..."
                      className="min-h-[80px] bg-background/50 border-border/50 text-sm"
                      disabled={isReplySubmitting}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleReply}
                      disabled={isReplySubmitting || !replyMessage.trim()}
                      className="bg-primary text-white hover:bg-primary/90"
                    >
                      {isReplySubmitting ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      Enviar respuesta
                    </Button>
                    <Button
                      onClick={() => setSelectedTicket(null)}
                      variant="outline"
                      disabled={isReplySubmitting}
                    >
                      Volver
                    </Button>
                  </div>
                </div>
              )}

              {isTicketClosed && (
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-sm text-green-400">
                  ✓ Este ticket está cerrado. No puedes enviar más mensajes.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    {/* ── Sección eliminar cuenta ─────────────────────────────────── */}
    <div className="mt-8 border border-red-500/20 rounded-xl p-5 bg-red-500/5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle className="h-4 w-4 text-red-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white mb-1">¿Quieres eliminar tu cuenta?</h3>
          <p className="text-xs text-white/50 mb-3 leading-relaxed">
            La eliminación de cuentas debe solicitarse a través de soporte. Crea un ticket con el asunto 
            <strong className="text-white/70"> "Solicitud de baja de cuenta"</strong> y nuestro equipo 
            lo gestionará en un plazo máximo de 48 horas.
          </p>
          <p className="text-xs text-white/40 mb-3">
            Si no obtienes respuesta en 48h, escríbenos también a{" "}
            <a href="mailto:soporte@marisai.es" className="text-[#a855f7] hover:underline">
              soporte@marisai.es
            </a>
          </p>
          <button
            onClick={() => {
              setShowForm(true);
              setSubject("Solicitud de baja de cuenta");
              setMessage("Hola, solicito la eliminación de mi cuenta y todos mis datos de Maris AI conforme al RGPD.");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-3 py-1.5 rounded-lg transition"
          >
            Solicitar baja de cuenta
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
