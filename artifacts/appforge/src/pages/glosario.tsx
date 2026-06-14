import { motion } from "framer-motion";
import { Link } from "wouter";
import { BookOpen, Search, Zap, Code2, Cpu, Globe, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

interface GlossaryTerm {
  term: string;
  definition: string;
  icon: LucideIcon;
  link?: string;
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: "Agente de IA",
    definition: "Un sistema de inteligencia artificial autónomo que puede percibir su entorno, razonar sobre objetivos y tomar acciones para completarlos sin intervención humana constante.",
    icon: Cpu,
    link: "/que-es-un-agente-de-ia",
  },
  {
    term: "Vibe Coding",
    definition: "Una forma de desarrollo de software donde el programador guía a la IA a través de lenguaje natural y descripciones de alto nivel, enfocándose en la intención y el diseño más que en la sintaxis del código.",
    icon: Zap,
    link: "/que-es-vibe-coding",
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

  useEffect(() => {
    // SEO: título y meta description específicos del glosario — apunta a
    // búsquedas tipo "qué es vibe coding", "qué es un agente de IA", etc.
    document.title = "Glosario de Vibe Coding e IA — Términos clave | Maris AI";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "Glosario en español de Vibe Coding e Inteligencia Artificial: qué es un agente de IA, qué es el vibe coding, LLM, MVP y más términos clave del desarrollo de software con IA.",
      );
    }

    // Canonical
    let canonicalLink = document.getElementById("canonical-tag") as HTMLLinkElement | null;
    if (!canonicalLink) {
      canonicalLink = document.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
    }
    if (!canonicalLink) {
      canonicalLink = document.createElement("link") as HTMLLinkElement;
      canonicalLink.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute("href", "https://www.marisai.es/glosario");

    // Schema.org — DefinedTermSet: ayuda a Google a entender esta página
    // como contenido de referencia/glosario (mejora E-E-A-T y puede generar
    // rich results para búsquedas tipo "qué es X").
    const existingJsonLd = document.querySelector('script[data-glossary-schema]');
    if (existingJsonLd) existingJsonLd.remove();

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "DefinedTermSet",
      "name": "Glosario de Vibe Coding e Inteligencia Artificial",
      "description": "Definiciones de los términos clave del desarrollo de software asistido por IA (vibe coding, agentes de IA, LLM, MVP y más).",
      "url": "https://www.marisai.es/glosario",
      "inLanguage": "es",
      "hasDefinedTerm": GLOSSARY_TERMS.map((t) => ({
        "@type": "DefinedTerm",
        "name": t.term,
        "description": t.definition,
        "inDefinedTermSet": "https://www.marisai.es/glosario",
      })),
    };

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-glossary-schema", "true");
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      const el = document.querySelector('script[data-glossary-schema]');
      if (el) el.remove();
    };
  }, []);

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
                  {term.link && (
                    <Link href={term.link} className="inline-block mt-2 text-sm text-primary hover:text-primary/80 underline underline-offset-2">
                      Leer guía completa →
                    </Link>
                  )}
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
