/**
 * PreGenerationChat — Conversational onboarding before app generation.
 * Mimics Emergent.sh's architect chat: the AI asks clarifying questions
 * before kicking off the multi-agent build pipeline.
 */
import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, Sparkles, Send, Cpu, Zap, Globe, Database,
  Smartphone, ShoppingCart, BarChart3, MessageSquare, Code2,
  Palette, Link, Layers, CheckCircle2, ChevronRight, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "architect" | "user";
  content: string;
  chips?: string[];
  isTyping?: boolean;
  timestamp: Date;
}

interface PreGenerationChatProps {
  initialPrompt: string;
  appKind: string;
  onConfirm: (enrichedPrompt: string) => void;
  onCancel: () => void;
  isGenerating?: boolean;
}

// ─── Architect avatar ─────────────────────────────────────────────────────────

function ArchitectAvatar({ size = "sm" }: { size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <div className={`${cls} rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 border border-violet-500/30 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20`}>
      <Cpu className={size === "lg" ? "h-5 w-5 text-white" : "h-4 w-4 text-white"} />
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

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

// ─── Conversation script ──────────────────────────────────────────────────────

function buildConversationScript(prompt: string, appKind: string) {
  const kindLabel: Record<string, string> = {
    webapp: "aplicación web",
    mobile: "app móvil",
    api: "API/backend",
    landing: "landing page",
    dashboard: "dashboard",
    ecommerce: "tienda online",
    game: "juego",
    tool: "herramienta",
  };
  const label = kindLabel[appKind] ?? "aplicación";

  return [
    {
      content: `¡Hola! Soy el **Arquitecto de Maris AI**. Voy a ayudarte a construir tu ${label}: **"${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"**.\n\nAntes de que los agentes empiecen a trabajar, necesito algunos detalles para que el resultado sea exactamente lo que tienes en mente. ¿Empezamos?`,
      chips: ["¡Vamos!", "Prefiero generar directamente"],
      delay: 600,
    },
    {
      content: `Perfecto. Primera pregunta: ¿cuál es el **objetivo principal** de esta ${label}? ¿Qué problema resuelve o qué valor aporta a los usuarios?`,
      chips: ["Gestión interna", "Venta de productos", "Información/contenido", "Entretenimiento", "Herramienta de productividad", "Red social"],
      delay: 800,
    },
    {
      content: `Entendido. Ahora dime: ¿quiénes son los **usuarios objetivo**? ¿Necesita autenticación (login/registro)?`,
      chips: ["Sí, con login", "No, acceso público", "Ambos (público + área privada)", "Solo admin"],
      delay: 800,
    },
    {
      content: `¿Qué **funcionalidades clave** debe tener en esta primera versión? Selecciona las que apliquen o descríbelas tú mismo.`,
      chips: ["Base de datos / CRUD", "Pagos (Stripe)", "Notificaciones", "Chat / Mensajería", "Mapas", "Gráficas / Analytics", "Subida de archivos", "API externa", "IA / LLM"],
      delay: 800,
      multiSelect: true,
    },
    {
      content: `¿Tienes alguna **preferencia de diseño**? Por ejemplo: colores de marca, estilo visual, referencias de otras apps que te gusten.`,
      chips: ["Minimalista y oscuro", "Moderno y colorido", "Profesional/corporativo", "Playful/divertido", "Sin preferencia"],
      delay: 800,
    },
    {
      content: `¡Perfecto! Ya tengo todo lo que necesito. Voy a preparar el brief completo para los agentes. ¿Listo para que empiece la construcción?`,
      chips: ["🚀 ¡Construir ahora!", "Añadir más detalles"],
      delay: 600,
      isFinal: true,
    },
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PreGenerationChat({
  initialPrompt,
  appKind,
  onConfirm,
  onCancel,
  isGenerating = false,
}: PreGenerationChatProps) {
  const script = buildConversationScript(initialPrompt, appKind);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scriptStep, setScriptStep] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [isArchitectTyping, setIsArchitectTyping] = useState(false);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [collectedAnswers, setCollectedAnswers] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [skipMode, setSkipMode] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Show first architect message on mount
  useEffect(() => {
    showArchitectMessage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isArchitectTyping]);

  const showArchitectMessage = (step: number) => {
    if (step >= script.length) return;
    const s = script[step];
    setIsArchitectTyping(true);
    setTimeout(() => {
      setIsArchitectTyping(false);
      setMessages(prev => [
        ...prev,
        {
          role: "architect",
          content: s.content,
          chips: s.chips,
          timestamp: new Date(),
        },
      ]);
      if ((s as any).isFinal) setIsComplete(true);
    }, s.delay);
  };

  const handleUserReply = (text: string) => {
    if (!text.trim()) return;
    const answer = text.trim();

    // Add user message
    setMessages(prev => [
      ...prev,
      { role: "user", content: answer, timestamp: new Date() },
    ]);
    setUserInput("");
    setSelectedChips([]);

    const newAnswers = [...collectedAnswers, answer];
    setCollectedAnswers(newAnswers);

    // Check if user wants to skip
    if (answer.toLowerCase().includes("directamente") || answer.toLowerCase().includes("saltar") || answer.toLowerCase().includes("skip")) {
      handleSkipAndGenerate(newAnswers);
      return;
    }

    // Check if user confirmed build (final step)
    if (isComplete || answer.includes("Construir") || answer.includes("🚀")) {
      handleBuildNow(newAnswers);
      return;
    }

    // Advance to next script step
    const nextStep = scriptStep + 1;
    setScriptStep(nextStep);
    showArchitectMessage(nextStep);
  };

  const handleChipClick = (chip: string) => {
    const s = script[scriptStep];
    if ((s as any).multiSelect) {
      setSelectedChips(prev =>
        prev.includes(chip) ? prev.filter(c => c !== chip) : [...prev, chip]
      );
      return;
    }
    // Single select — treat as immediate reply
    if (chip.includes("Construir") || chip.includes("🚀")) {
      const finalAnswers = [...collectedAnswers, chip];
      setCollectedAnswers(finalAnswers);
      setMessages(prev => [...prev, { role: "user", content: chip, timestamp: new Date() }]);
      handleBuildNow(finalAnswers);
      return;
    }
    if (chip.includes("directamente") || chip.includes("Saltar")) {
      handleSkipAndGenerate(collectedAnswers);
      return;
    }
    handleUserReply(chip);
  };

  const handleMultiSelectConfirm = () => {
    if (selectedChips.length === 0) {
      handleUserReply("Sin preferencia específica");
    } else {
      handleUserReply(selectedChips.join(", "));
    }
  };

  const handleBuildNow = (answers: string[]) => {
    const enriched = buildEnrichedPrompt(initialPrompt, answers);
    setTimeout(() => onConfirm(enriched), 300);
  };

  const handleSkipAndGenerate = (answers: string[]) => {
    setSkipMode(true);
    const enriched = answers.length > 0
      ? buildEnrichedPrompt(initialPrompt, answers)
      : initialPrompt;
    setTimeout(() => onConfirm(enriched), 300);
  };

  const buildEnrichedPrompt = (base: string, answers: string[]): string => {
    if (answers.length === 0) return base;
    const questions = script.slice(1, answers.length + 1).map(s => s.content.split("\n")[0].replace(/\*\*/g, "").replace(/\?.*/, "").trim());
    const context = answers
      .map((a, i) => `${questions[i] ?? `Pregunta ${i + 1}`}: ${a}`)
      .join("\n");
    return `${base}\n\n--- Contexto adicional del usuario ---\n${context}`;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const s = script[scriptStep];
      if ((s as any)?.multiSelect && selectedChips.length > 0) {
        handleMultiSelectConfirm();
      } else if (userInput.trim()) {
        handleUserReply(userInput);
      }
    }
  };

  const currentScript = script[scriptStep];
  const isMultiSelect = !!(currentScript as any)?.multiSelect;

  // ── Render ──────────────────────────────────────────────────────────────────
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
                En línea
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Preparando el brief para los agentes de construcción</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-white text-xs"
            onClick={() => handleSkipAndGenerate(collectedAnswers)}
            disabled={isGenerating}
          >
            <Zap className="h-3.5 w-3.5 mr-1" />
            Generar directamente
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            onClick={onCancel}
            disabled={isGenerating}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-white/5 flex-shrink-0">
        <motion.div
          className="h-full bg-gradient-to-r from-violet-500 to-indigo-500"
          initial={{ width: "0%" }}
          animate={{ width: `${Math.min(100, (scriptStep / (script.length - 1)) * 100)}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 custom-scrollbar">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Initial prompt bubble */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-end"
          >
            <div className="max-w-sm bg-primary/15 border border-primary/20 rounded-2xl rounded-tr-sm px-4 py-3">
              <p className="text-sm text-white/90 leading-relaxed">{initialPrompt}</p>
              <p className="text-[10px] text-muted-foreground mt-1 text-right">Tu prompt inicial</p>
            </div>
          </motion.div>

          {/* Chat messages */}
          <AnimatePresence mode="popLayout">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "architect" && <ArchitectAvatar />}
                <div className={`max-w-lg ${msg.role === "user" ? "order-first" : ""}`}>
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "architect"
                      ? "bg-card/60 border border-white/8 text-white/90 rounded-tl-sm"
                      : "bg-primary/15 border border-primary/20 text-white/90 rounded-tr-sm"
                  }`}>
                    {/* Render bold markdown */}
                    <span dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/\n/g, '<br/>') }} />
                  </div>
                  {/* Chips for architect messages */}
                  {msg.role === "architect" && msg.chips && i === messages.length - 1 && !isArchitectTyping && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.chips.map(chip => {
                        const isSelected = selectedChips.includes(chip);
                        return (
                          <button
                            key={chip}
                            onClick={() => handleChipClick(chip)}
                            className={`text-xs px-3 py-1.5 rounded-full border transition-all duration-150 ${
                              isSelected
                                ? "bg-primary/20 border-primary/50 text-primary"
                                : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20 hover:text-white"
                            } ${chip.includes("🚀") ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20" : ""}`}
                          >
                            {chip}
                          </button>
                        );
                      })}
                      {isMultiSelect && selectedChips.length > 0 && (
                        <button
                          onClick={handleMultiSelectConfirm}
                          className="text-xs px-3 py-1.5 rounded-full border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 transition-all flex items-center gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Confirmar selección ({selectedChips.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="h-8 w-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">Tú</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator */}
          <AnimatePresence>
            {isArchitectTyping && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex gap-3 items-start"
              >
                <ArchitectAvatar />
                <div className="bg-card/60 border border-white/8 rounded-2xl rounded-tl-sm">
                  <TypingDots />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generating state */}
          <AnimatePresence>
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex justify-center py-4"
              >
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

      {/* Input area */}
      {!isGenerating && (
        <div className="flex-shrink-0 border-t border-white/5 bg-black/40 backdrop-blur-sm px-4 py-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-3 items-end">
              <div className="flex-1 relative">
                <Textarea
                  ref={inputRef}
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isComplete
                      ? "Escribe cualquier detalle adicional o pulsa '🚀 Construir ahora'..."
                      : isArchitectTyping
                      ? "El Arquitecto está escribiendo..."
                      : "Escribe tu respuesta o selecciona una opción arriba..."
                  }
                  disabled={isArchitectTyping || isGenerating}
                  className="bg-card/40 border-white/10 focus:border-violet-500/50 resize-none min-h-[48px] max-h-[120px] pr-12 text-sm placeholder:text-muted-foreground/50"
                  rows={1}
                />
              </div>
              <Button
                className="h-12 px-4 bg-violet-600 hover:bg-violet-700 text-white flex-shrink-0"
                disabled={(!userInput.trim() && selectedChips.length === 0) || isArchitectTyping || isGenerating}
                onClick={() => {
                  if (isMultiSelect && selectedChips.length > 0) {
                    handleMultiSelectConfirm();
                  } else if (userInput.trim()) {
                    handleUserReply(userInput);
                  }
                }}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
              Enter para enviar · Shift+Enter para nueva línea · o selecciona una opción de arriba
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
