import { motion } from "framer-motion";
import { Link } from "wouter";
import { BookOpen, Search, Zap, Code2, Cpu, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";

const GLOSSARY_TERMS = [
  {
    term: "Agente de IA",
    definition: "Un sistema de inteligencia artificial autónomo que puede percibir su entorno, razonar sobre objetivos y tomar acciones para completarlos sin intervención humana constante.",
    icon: Cpu
  },
  {
    term: "Vibe Coding",
    definition: "Una forma de desarrollo de software donde el programador guía a la IA a través de lenguaje natural y descripciones de alto nivel, enfocándose en la intención y el diseño más que en la sintaxis del código.",
    icon: Zap
  },
  {
    term: "LLM (Large Language Model)",
    definition: "Modelos de lenguaje a gran escala, como GPT-4 o Claude, entrenados con inmensas cantidades de texto para entender y generar lenguaje humano de forma coherente.",
    icon: BookOpen
  },
  {
    term: "Full-stack IA",
    definition: "Desarrollo de aplicaciones completas (frontend, backend y base de datos) utilizando herramientas de inteligencia artificial para automatizar cada capa del stack tecnológico.",
    icon: Code2
  },
  {
    term: "MVP (Minimum Viable Product)",
    definition: "Versión inicial de un producto con las funcionalidades mínimas necesarias para validar una idea de negocio con usuarios reales.",
    icon: Globe
  }
];

export default function GlossaryPage() {
  const [search, setSearch] = useState("");

  const filteredTerms = GLOSSARY_TERMS.filter(t => 
    t.term.toLowerCase().includes(search.toLowerCase()) || 
    t.definition.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background py-20 px-4">
      <div className="container max-w-4xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">Glosario de IA</h1>
          <p className="text-lg text-muted-foreground">Aprende los términos clave del futuro del desarrollo de software.</p>
        </motion.div>

        <div className="relative mb-12">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input 
            className="pl-10 h-12 bg-card/50 border-white/10 text-white"
            placeholder="Busca un término..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid gap-6">
          {filteredTerms.map((term, i) => (
            <motion.div
              key={term.term}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl border border-white/5 bg-card/30 backdrop-blur-sm"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary">
                  <term.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">{term.term}</h3>
                  <p className="text-muted-foreground leading-relaxed">{term.definition}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-20 p-8 rounded-3xl bg-gradient-to-r from-primary/20 to-purple-500/20 border border-primary/30 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">¿Listo para construir con IA?</h2>
          <p className="text-muted-foreground mb-6">Usa estos conceptos para crear tu próxima app en minutos con Maris AI.</p>
          <Link href="/sign-up">
            <button className="bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-full font-bold transition-all">
              Empezar Gratis
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
