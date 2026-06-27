import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Zap,
  Globe,
  Cpu,
  ArrowRight,
  CheckCircle2,
  Rocket,
  Star,
  Code,
  Palette,
  Database,
} from "lucide-react";

// ✅ Seguimiento 4: Pantalla de bienvenida/onboarding para nuevos usuarios

// NOTA — eliminada la conversión de Google Ads que se disparaba aquí
// (fireGoogleAdsConversion, ID AW-18218229959/bd7tCPjYwbwcEMfBkO9D): era una
// implementación DUPLICADA de la misma conversión "Registro" que ya dispara
// trackSignUp() en App.tsx al detectar un usuario nuevo (creado hace <2min).
// La de App.tsx es la correcta — incluye gtag('set','user_data',{sha256_email})
// para Conversiones Mejoradas ANTES del evento; esta no lo hacía. Disparar
// AMBAS para el mismo registro real enviaba a Google Ads una mezcla de
// conversiones con y sin los datos hasheados de Conversiones Mejoradas —
// la causa real del aviso "Conversiones mejoradas tiene problemas de
// configuración... Implementa código en la página además del automático",
// que a su vez limitaba el alcance de la campaña (puja por conversiones sin
// suficientes datos limpios para aprender). Se mantiene solo el disparo de
// Meta Pixel, que no estaba duplicado en ningún otro sitio.
function fireMetaPixelRegistration() {
  try {
    if (typeof (window as any).fbq === 'function') {
      (window as any).fbq('track', 'CompleteRegistration', { value: 1.0, currency: 'EUR' });
    }
  } catch {
    // no bloquear el flujo de onboarding si Meta Pixel falla
  }
}

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const firstName = user?.firstName || user?.fullName?.split(" ")[0] || "ahí";

  useEffect(() => {
    fireMetaPixelRegistration();
  }, []);

  const APP_TYPES = [
    { id: "web", label: "App Web", icon: Globe, description: "SaaS, dashboards, portales", cost: 3 },
    { id: "landing", label: "Landing Page", icon: Sparkles, description: "Páginas de venta, portfolios", cost: 2 },
    { id: "ecommerce", label: "E-Commerce", icon: Star, description: "Tiendas online, catálogos", cost: 4 },
    { id: "api", label: "API / Backend", icon: Database, description: "REST APIs, microservicios", cost: 3 },
    { id: "mobile", label: "App Móvil", icon: Cpu, description: "iOS / Android con React Native", cost: 5 },
    { id: "ui", label: "Componente UI", icon: Palette, description: "Componentes, design systems", cost: 2 },
  ];

  const FEATURES = [
    { icon: Zap, title: "9 agentes de IA especializados", description: "Frontend, Backend, Testing, Planner, Researcher y más trabajando en paralelo." },
    { icon: Code, title: "Código real y funcional", description: "React, TypeScript, TailwindCSS, Node.js — código que puedes descargar y modificar." },
    { icon: Globe, title: "Deploy en un clic", description: "Publica tu app en marisai.es con subdominio gratuito. Dominio personalizado con plan de pago." },
    { icon: Rocket, title: "15 créditos de bienvenida", description: "Suficientes para crear hasta 16 apps completas. Sin tarjeta de crédito." },
  ];

  return (
    <div className="min-h-screen bg-[#080b14] text-white">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.15),transparent_60%),radial-gradient(ellipse_at_bottom-right,rgba(34,211,238,0.08),transparent_50%)]" />
      <div className="fixed inset-0 opacity-[0.15] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative z-10 mx-auto max-w-3xl px-4 py-16">

        {/* Step indicator */}
        <div className="mb-12 flex items-center justify-center gap-3">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                step === s ? "bg-[#7c3aed] text-white shadow-[0_0_16px_rgba(124,58,237,0.6)]" :
                step > s ? "bg-[#7c3aed]/30 text-[#a78bfa]" : "bg-white/8 text-white/30"
              }`}>
                {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
              </div>
              {s < 3 && <div className={`h-px w-12 transition-all ${step > s ? "bg-[#7c3aed]/50" : "bg-white/10"}`} />}
            </div>
          ))}
        </div>

        {/* STEP 1: Bienvenida + créditos */}
        {step === 1 && (
          <div className="text-center">
            {/* Logo */}
            <div className="mb-8 flex justify-center">
              <div className="relative h-16 w-18">
                <div className="absolute left-0 top-4 h-9 w-5 rotate-[28deg] rounded-full bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] shadow-[0_0_28px_rgba(124,58,237,0.8)]" />
                <div className="absolute left-5 top-2 h-11 w-5 -rotate-[26deg] rounded-full bg-gradient-to-b from-[#a855f7] to-[#ec4899] shadow-[0_0_24px_rgba(168,85,247,0.7)]" />
                <div className="absolute left-[38px] top-2 h-11 w-5 rotate-[18deg] rounded-full bg-gradient-to-b from-[#22d3ee] to-[#3b82f6] shadow-[0_0_28px_rgba(34,211,238,0.8)]" />
              </div>
            </div>

            <h1 className="mb-3 text-4xl font-extrabold tracking-tight">
              ¡Bienvenido, <span className="bg-gradient-to-r from-[#a78bfa] via-[#c084fc] to-[#22d3ee] bg-clip-text text-transparent">{firstName}</span>!
            </h1>
            <p className="mb-10 text-lg text-white/55">
              Maris AI te regala <strong className="text-yellow-400">15 créditos</strong> para empezar a crear apps increíbles con inteligencia artificial.
            </p>

            {/* Credits badge */}
            <div className="mb-10 inline-flex items-center gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/8 px-8 py-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/15">
                <Cpu className="h-6 w-6 text-yellow-400" />
              </div>
              <div className="text-left">
                <p className="text-2xl font-extrabold text-yellow-400">15 créditos</p>
                <p className="text-sm text-white/45">gratis al registrarte · sin tarjeta</p>
              </div>
            </div>

            {/* Features grid */}
            <div className="mb-10 grid grid-cols-2 gap-4 text-left">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#7c3aed]/15">
                    <f.icon className="h-5 w-5 text-[#a78bfa]" />
                  </div>
                  <h3 className="mb-1 text-sm font-bold text-white">{f.title}</h3>
                  <p className="text-xs leading-relaxed text-white/45">{f.description}</p>
                </div>
              ))}
            </div>

            <Button
              size="lg"
              onClick={() => setStep(2)}
              className="h-14 w-full max-w-sm bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-base font-bold hover:from-[#8b5cf6] hover:to-[#a855f7]"
            >
              Empezar <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        )}

        {/* STEP 2: Selección del tipo de app */}
        {step === 2 && (
          <div>
            <div className="mb-8 text-center">
              <h2 className="mb-2 text-3xl font-extrabold">¿Qué quieres crear?</h2>
              <p className="text-white/45">Elige el tipo de proyecto que más te interesa para personalizar tu experiencia.</p>
            </div>

            <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {APP_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setSelectedType(type.id)}
                  className={`flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all ${
                    selectedType === type.id
                      ? "border-[#7c3aed] bg-[#7c3aed]/10 shadow-[0_0_20px_rgba(124,58,237,0.2)]"
                      : "border-white/8 bg-white/[0.035] hover:border-white/15 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${selectedType === type.id ? "bg-[#7c3aed]/25" : "bg-white/8"}`}>
                    <type.icon className={`h-5 w-5 ${selectedType === type.id ? "text-[#a78bfa]" : "text-white/50"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{type.label}</p>
                    <p className="text-xs text-white/40">{type.description}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5">
                    <Cpu className="h-3 w-3 text-yellow-400" />
                    <span className="text-[10px] font-bold text-yellow-400">{type.cost} cr</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep(1)} className="h-12 flex-1 border-white/10 bg-transparent text-white/60 hover:bg-white/5 hover:text-white">
                Atrás
              </Button>
              <Button
                size="lg"
                onClick={() => setStep(3)}
                disabled={!selectedType}
                className="h-12 flex-[2] bg-gradient-to-r from-[#7c3aed] to-[#9333ea] font-bold hover:from-[#8b5cf6] hover:to-[#a855f7] disabled:opacity-40"
              >
                Continuar <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Listo para empezar */}
        {step === 3 && (
          <div className="text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#9333ea] shadow-[0_0_40px_rgba(124,58,237,0.5)]">
                <Rocket className="h-10 w-10 text-white" />
              </div>
            </div>

            <h2 className="mb-3 text-3xl font-extrabold">¡Todo listo, {firstName}!</h2>
            <p className="mb-8 text-white/45">
              Tienes <strong className="text-yellow-400">15 créditos</strong> listos para usar. Describe tu idea y Maris AI la construirá en minutos.
            </p>

            {/* Checklist */}
            <div className="mb-8 space-y-3 text-left">
              {[
                "Cuenta creada y verificada",
                "15 créditos de bienvenida asignados",
                "9 agentes de IA listos para trabajar",
                `Tipo de proyecto seleccionado: ${APP_TYPES.find(t => t.id === selectedType)?.label ?? "App Web"}`,
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.035] px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  <span className="text-sm text-white/75">{item}</span>
                </div>
              ))}
            </div>

            <Button
              size="lg"
              onClick={() => setLocation("/dashboard")}
              className="h-14 w-full bg-gradient-to-r from-[#7c3aed] to-[#9333ea] text-base font-bold shadow-[0_0_30px_rgba(124,58,237,0.4)] hover:from-[#8b5cf6] hover:to-[#a855f7]"
            >
              <Sparkles className="mr-2 h-5 w-5" />
              Ir al Dashboard y crear mi primera app
            </Button>

            <p className="mt-4 text-xs text-white/25">
              Puedes volver a esta guía en cualquier momento desde Configuración → Ayuda
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
