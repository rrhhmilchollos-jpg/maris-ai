/**
 * PreGenerationChat — Arquitecto IA conversacional antes de generar.
 * 1) Llama a /api/apps/plan-preview para analizar el prompt con IA
 * 2) Le muestra al usuario qué va a incluir y qué extras propone
 * 3) El usuario decide qué extras quiere ANTES de gastar créditos
 * 4) Solo entonces se lanza la generación con el prompt enriquecido
 */
import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import {
  Cpu, Send, Zap, X, CheckCircle2, Sparkles, Plus, Check, Mic, MicOff, Square,
} from "lucide-react";

interface ChatMessage {
  role: "architect" | "user";
  content: string;
  extras?: PlanExtra[];
  included?: string[];
  isTyping?: boolean;
  timestamp: Date;
}

interface PlanExtra {
  id: string;
  label: string;
  why: string;
}

interface PlanPreview {
  title: string;
  summary: string;
  included: string[];
  extras: PlanExtra[];
  estimatedPages: number;
  backendNeeded: boolean;
}

interface PreGenerationChatProps {
  initialPrompt: string;
  appKind: string;
  onConfirm: (enrichedPrompt: string) => void;
  onCancel: () => void;
  isGenerating?: boolean;
}

function ArchitectAvatar({ size = "sm" }: { size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <div className={`${cls} rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 border border-violet-500/30 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20`}>
      <Cpu className={size === "lg" ? "h-5 w-5 text-white" : "h-4 w-4 text-white"} />
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-violet-400"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

// ── Micrófono — hook de voz ──────────────────────────────────────────────────
function useSpeechRecognition(onResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setIsSupported(true);
      const recognition = new SpeechRecognition();
      recognition.lang = "es-ES";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        onResult(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const startListening = () => {
    if (!recognitionRef.current || isListening) return;
    recognitionRef.current.start();
    setIsListening(true);
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  };

  return { isListening, isSupported, startListening, stopListening };
}

// ── Botón de micrófono ───────────────────────────────────────────────────────
function MicButton({
  isListening,
  isSupported,
  onStart,
  onStop,
}: {
  isListening: boolean;
  isSupported: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (!isSupported) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className={`relative border-white/10 px-3 transition-all duration-200 ${
        isListening
          ? "border-red-500/60 bg-red-500/10 hover:bg-red-500/20 text-red-400"
          : "hover:border-violet-500/40 hover:bg-violet-500/10 text-white/50 hover:text-violet-300"
      }`}
      onClick={isListening ? onStop : onStart}
      title={isListening ? "Detener grabación" : "Hablar por voz"}
    >
      {isListening ? (
        <>
          {/* Pulso animado mientras escucha */}
          <span className="absolute inset-0 rounded-md animate-ping bg-red-500/20" />
          <Square className="h-4 w-4 relative z-10" />
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}

export function PreGenerationChat({
  initialPrompt,
  appKind,
  onConfirm,
  onCancel,
  isGenerating = false,
}: PreGenerationChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [plan, setPlan] = useState<PlanPreview | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"loading" | "plan" | "clarify" | "ready" | "generating">("loading");
  const [userInput, setUserInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Voz ──
  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition(
    (transcript) => {
      // El texto reconocido se añade al textarea
      setUserInput(prev => (prev ? prev + " " + transcript : transcript));
    }
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Al montar: llama a plan-preview con IA
  useEffect(() => {
    loadPlan();
  }, []);

  const addArchitectMsg = (content: string, extras?: PlanExtra[], included?: string[]) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: "architect", content, extras, included, timestamp: new Date(),
      }]);
    }, 700);
  };

  const loadPlan = async () => {
    // Mensaje inicial mientras carga
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages([{
        role: "architect",
        content: `Analizando tu idea… dame un segundo. 🔍`,
        timestamp: new Date(),
      }]);
    }, 400);

    try {
      const data = await apiFetch<any>("/api/apps/plan-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: initialPrompt, kind: appKind }),
      });

      if (!data?.plan) throw new Error("Sin plan");
      const p: PlanPreview = data.plan;
      setPlan(p);

      // Mostrar el plan al usuario
      setTimeout(() => {
        addArchitectMsg(
          `He preparado el plan para **${p.title}**. ${p.summary}

¿Quieres cambiar el nombre del proyecto o añadir algo antes de empezar?`,
          p.extras.length > 0 ? p.extras : undefined,
          p.included,
        );
        setPhase(p.extras.length > 0 ? "plan" : "ready");
      }, 1200);
    } catch (err) {
      // Fallback: limpiar el prompt y preguntar el nombre del proyecto
      setIsTyping(false);
      const cleanPrompt = initialPrompt
        .replace(/^hola[,.]?\s*/i, "")
        .replace(/^me ayudas a /i, "")
        .replace(/^puedes /i, "")
        .replace(/^quiero /i, "")
        .replace(/^necesito /i, "")
        .replace(/[?¿!¡]+/g, "")
        .trim();
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role: "architect",
          content: `Entendido, vamos a construir **${cleanPrompt.slice(0, 80)}**. ¿Cómo quieres llamar al proyecto? Y si tienes algún detalle más, cuéntame.`,
          timestamp: new Date(),
        }]);
        setPhase("ready");
      }, 600);
    }
  };

  const toggleExtra = (id: string) => {
    setSelectedExtras(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmExtras = () => {
    const chosen = plan?.extras.filter(e => selectedExtras.has(e.id)) ?? [];
    if (chosen.length > 0) {
      const listMsg = chosen.map(e => `✅ ${e.label}`).join("
");
      setMessages(prev => [...prev, {
        role: "user",
        content: `Quiero añadir:
${listMsg}`,
        timestamp: new Date(),
      }]);
      addArchitectMsg(`Perfecto, incluiré también:
${chosen.map(e => `• **${e.label}**: ${e.why}`).join("
")}

¿Algún detalle adicional o empezamos a construir?`);
    } else {
      setMessages(prev => [...prev, {
        role: "user",
        content: "Solo lo que has propuesto, sin extras.",
        timestamp: new Date(),
      }]);
      addArchitectMsg("Entendido, me ciño exactamente a lo que pediste. ¿Empezamos?");
    }
    setPhase("ready");
  };

  const skipExtras = () => {
    setMessages(prev => [...prev, {
      role: "user",
      content: "Generar directamente sin extras.",
      timestamp: new Date(),
    }]);
    setPhase("ready");
    setTimeout(() => handleBuild(), 300);
  };

  const handleUserMsg = () => {
    if (!userInput.trim()) return;
    const msg = userInput.trim();
    setMessages(prev => [...prev, { role: "user", content: msg, timestamp: new Date() }]);
    setUserInput("");

    if (phase === "ready") {
      handleBuild(msg);
    } else {
      // Respuesta del usuario en fase plan
      addArchitectMsg("Anotado. ¿Listo para construir o quieres ajustar algo más?");
      setPhase("ready");
    }
  };

  const handleBuild = (extraDetails?: string) => {
    // Si el usuario escribe algo que indica que no quiere crear, cancelar
    if (extraDetails) {
      const t = extraDetails.toLowerCase().trim();
      const cancelSignals = ["no quiero", "no crear", "no generar", "cancelar", "cancel", "salir", "exit", "olvídalo", "olvidalo", "déjalo", "dejalo", "no importa"];
      if (cancelSignals.some(s => t.includes(s))) {
        onCancel();
        return;
      }
    }

    setPhase("generating");
    const chosen = plan?.extras.filter(e => selectedExtras.has(e.id)) ?? [];

    let enriched = initialPrompt;
    if (chosen.length > 0) {
      enriched += `

[EXTRAS CONFIRMADOS POR EL USUARIO]
${chosen.map(e => `- ${e.label}: ${e.why}`).join("
")}`;
    }
    if (extraDetails) {
      enriched += `

[DETALLES ADICIONALES DEL USUARIO]
${extraDetails}`;
    }

    setTimeout(() => onConfirm(enriched), 300);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserMsg();
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/40 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <ArchitectAvatar size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">Arquitecto</span>
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 text-[10px] uppercase font-mono">Maris AI</Badge>
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Analizando
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Revisando tu proyecto antes de construir</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm"
            className="text-muted-foreground hover:text-white text-xs"
            onClick={() => onConfirm(initialPrompt)}
            disabled={isGenerating}>
            <Zap className="h-3.5 w-3.5 mr-1" />Generar directamente
          </Button>
          <Button variant="ghost" size="sm"
            className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            onClick={onCancel} disabled={isGenerating}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Prompt inicial */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
            <div className="max-w-sm bg-primary/15 border border-primary/20 rounded-2xl rounded-tr-sm px-4 py-3">
              <p className="text-sm text-white/90 leading-relaxed">{initialPrompt}</p>
              <p className="text-[10px] text-muted-foreground mt-1 text-right">Tu prompt</p>
            </div>
          </motion.div>

          {/* Mensajes */}
          <AnimatePresence mode="popLayout">
            {messages.map((msg, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "architect" && <ArchitectAvatar />}
                <div className="max-w-lg flex-1">
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "architect"
                      ? "bg-card/60 border border-white/8 text-white/90 rounded-tl-sm"
                      : "bg-primary/15 border border-primary/20 text-white/90 rounded-tr-sm"
                  }`}>
                    <span dangerouslySetInnerHTML={{
                      __html: msg.content
                        .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
                        .replace(/
/g, "<br/>")
                    }} />
                  </div>

                  {/* Funcionalidades incluidas */}
                  {msg.included && msg.included.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[11px] text-white/40 font-medium px-1">✅ Incluido en tu plan:</p>
                      {msg.included.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2">
                          <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                          <span className="text-xs text-white/80">{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extras propuestos */}
                  {msg.extras && msg.extras.length > 0 && phase === "plan" && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-white/40 font-medium px-1">💡 También podría añadir (tú decides):</p>
                      {msg.extras.map(extra => (
                        <button key={extra.id}
                          onClick={() => toggleExtra(extra.id)}
                          className={`w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                            selectedExtras.has(extra.id)
                              ? "bg-violet-500/15 border-violet-500/40"
                              : "bg-white/3 border-white/10 hover:border-white/20"
                          }`}>
                          <div className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-all ${
                            selectedExtras.has(extra.id)
                              ? "bg-violet-500 border-violet-400"
                              : "border-white/20"
                          }`}>
                            {selectedExtras.has(extra.id) && <Check className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-white/90">{extra.label}</p>
                            <p className="text-[11px] text-white/40 mt-0.5">{extra.why}</p>
                          </div>
                        </button>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-xs h-8"
                          onClick={confirmExtras}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          {selectedExtras.size > 0 ? `Añadir ${selectedExtras.size} extra${selectedExtras.size > 1 ? "s" : ""}` : "Continuar sin extras"}
                        </Button>
                        <Button size="sm" variant="outline"
                          className="border-white/10 text-white/50 text-xs h-8 hover:bg-white/5"
                          onClick={skipExtras}>
                          <Zap className="h-3 w-3 mr-1" />Generar ya
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="h-8 w-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">Tú</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing */}
          <AnimatePresence>
            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex gap-3 items-start">
                <ArchitectAvatar />
                <div className="bg-card/60 border border-white/8 rounded-2xl rounded-tl-sm">
                  <TypingDots />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generating */}
          <AnimatePresence>
            {(phase === "generating" || isGenerating) && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex justify-center py-4">
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-3">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm text-emerald-400 font-medium">Iniciando los agentes de construcción...</span>
                  <Sparkles className="h-4 w-4 text-emerald-400 animate-pulse" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input — solo cuando está ready */}
      {phase === "ready" && !isGenerating && (
        <div className="flex-shrink-0 border-t border-white/5 bg-black/40 backdrop-blur-sm px-4 py-4">
          <div className="max-w-2xl mx-auto space-y-2">
            <div className="flex gap-2">
              <Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-medium"
                onClick={() => handleBuild()}>
                <Sparkles className="h-4 w-4 mr-2" />
                🚀 Construir ahora
              </Button>
            </div>
            <div className="flex gap-2">
              <Textarea
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={isListening ? "🎙️ Escuchando... habla ahora" : "O escribe un detalle adicional antes de generar..."}
                className={`bg-card/40 border-white/10 focus:border-violet-500/50 resize-none text-sm min-h-[40px] max-h-[100px] transition-colors ${
                  isListening ? "border-red-500/40 bg-red-500/5" : ""
                }`}
                rows={1}
              />
              {/* Micrófono */}
              <MicButton
                isListening={isListening}
                isSupported={isSupported}
                onStart={startListening}
                onStop={stopListening}
              />
              {/* Enviar */}
              <Button variant="outline" className="border-white/10 px-3"
                disabled={!userInput.trim()}
                onClick={handleUserMsg}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 text-center">
              {isListening
                ? "🔴 Grabando — pulsa el cuadrado para detener"
                : "Enter para enviar · 🎙️ micrófono para hablar · o pulsa \"Construir ahora\""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
