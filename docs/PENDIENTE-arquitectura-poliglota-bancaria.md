# PENDIENTE — Arquitectura Políglota / Sistemas Empresariales y Bancarios

**Estado: NO IMPLEMENTADO.** Este documento es solo un registro de diseño recopilado
a petición explícita del usuario, para activarlo en una sesión futura cuando él lo
indique de forma explícita ("vamos a implementar todo esto de una vez"). Nada de lo
descrito aquí está conectado al código real de Maris AI hoy.

Fecha de recopilación: 30 jun 2026.

---

## 0. Estado real confirmado del sistema HOY (auditado antes de escribir este documento)

- El sandbox de validación (`e2bValidator.ts`) usa **E2B con la plantilla por defecto**,
  sin Dockerfile personalizado. Ejecuta siempre `npm install && npm run build`.
- Si el bundle generado no tiene `package.json`, el sandbox **falla inmediatamente**
  con `reason: "bundle has no package.json"` — el sistema asume Node.js de raíz, sin
  ninguna excepción.
- El deploy real (`vercelDeploy.ts`) es **Vite estático a Vercel** (`framework: "vite"`
  o `framework: null` para HTML estático). No hay ningún mecanismo de despliegue de
  contenedores, clústeres, ni infraestructura como código.
- El `CoreOrchestrator.ts` (el planificador de hitos) no tiene ningún concepto de
  "lenguaje de backend objetivo" — todos los hitos de backend asumen Express/Node.
- `GenLanguage` (el tipo que distingue idiomas del proyecto) hoy solo admite
  `"typescript" | "javascript"`.

Esto confirma que la propuesta es correcta en su diagnóstico: el sistema completo
(generación, validación, preview, deploy) está construido sobre la suposición de que
todo proyecto es una SPA Node.js/npm. No hay ninguna pieza parcial reutilizable para
Java/Go/Rust hoy — sería una reescritura real, no una extensión incremental.

---

## 1. El riesgo legal/de seguridad que hay que resolver ANTES de activar nada de esto

Generar un "system prompt" que le diga al modelo "usa AES-256, SHA-256 hash chaining,
cumple PCI-DSS" **no hace que el código resultante cumpla PCI-DSS de verdad**.
PCI-DSS exige auditorías externas certificadas, gestión de claves en HSM, segmentación
de red real y procesos de cumplimiento continuos que ningún LLM puede garantizar solo
con instrucciones de prompt. Si se activa esto y se anuncia públicamente como
"genera sistemas bancarios reales", el riesgo legal y reputacional es serio si un
cliente lo usa para manejar dinero real y algo falla.

**Decisión pendiente de tomar en el momento de activación**: o bien (a) esto se queda
como mejora de calidad de buenas prácticas de seguridad SIN anunciarse como
"sistema bancario real" en ningún sitio visible al cliente, o (b) se invierte en
módulos de Terraform pre-auditados y certificados de verdad (sección 4) antes de
anunciar nada — nunca confiar en que el LLM "invente" la seguridad real.

---

## 2. Modificación 1 — Orquestación Backend Políglota

**Objetivo**: que el Agente Arquitecto pueda elegir Spring Boot (Java), Go o Rust en
vez de Node.js cuando detecte un sistema de alta criticidad transaccional.

**Cambios necesarios** (ninguno aplicado todavía):
- `CoreOrchestrator.ts` / `CoreOrchestratorOptions`: nueva propiedad
  `targetBackendFramework?: "nodejs" | "spring-boot" | "go" | "rust"`.
- El planificador de hitos (`planMonorepoProject`) necesita un nuevo bloque de
  detección: si el prompt contiene señales de alta criticidad (banca, pasarelas
  complejas, ERPs masivos) — posiblemente reutilizando o extendiendo
  `classifyPromptComplexity` — decide el framework y lo inyecta en el prompt del
  arquitecto, similar al patrón ya usado hoy para `FREE_TIER_ARCHITECT_DIRECTIVE`.
- `GenLanguage` necesita extenderse más allá de `"typescript" | "javascript"`.
- Cada hito de backend necesitaría un nuevo "Agente de Código Especializado" por
  lenguaje (Go, Rust, Java/Spring) con su propio system prompt de calidad — el
  equivalente a `BACKEND_SYSTEM_PROMPT`/`BACKEND_SYSTEM_PROMPT_POSTGRES` ya
  existentes, pero para cada lenguaje nuevo.

---

## 3. Modificación 2 — Sandbox de Validación Universal

**Objetivo**: que el sandbox de validación entienda y compile Java/Go/Rust, no solo
Node.

**Cambios necesarios**:
- Construir una imagen E2B personalizada (E2B permite Dockerfile custom) con: JDK
  (Spring Boot), Go compiler, Rust toolchain (cargo), Docker-in-Docker, y Node.js
  (para seguir validando frontend).
- `e2bValidator.ts` necesita dejar de asumir `package.json` obligatorio — debe
  detectar el lenguaje principal del bundle (por la presencia de `pom.xml`,
  `go.mod`, `Cargo.toml`, o `package.json`) e inyectar el comando de validación
  correcto: `mvn clean compile`, `go build ./...`, `cargo check`, o `npm run build`.
- Esto afecta también a `MAX_FIX_CYCLES`/`runTestingAgent` y al resto del pipeline
  de reparación automática, que hoy asumen JS/TS en sus reglas (ej. las reglas de
  wouter, las reglas de catch-all) — necesitarían variantes por lenguaje.

---

## 4. Modificación 3 — Infraestructura como Código y Despliegue Real

**Objetivo**: pasar de "deploy estático a Vercel" a un pipeline real de
contenedores + infraestructura en la nube.

**Cambios necesarios**:
- Nuevo hito obligatorio del Arquitecto: "Infrastructure & Deployment Definition" —
  genera Dockerfile, manifiestos de Kubernetes (`deployment.yaml`), y/o scripts de
  Terraform.
- Nuevo módulo `cloudDeploy.ts` (alternativa a `vercelDeploy.ts`) que, cuando el
  proyecto requiere infraestructura empresarial completa, exporta e inyecta estas
  recetas en el repositorio de GitHub del cliente.
- Para el caso bancario específico: en vez de dejar que el LLM "invente" la
  configuración de seguridad, usar **módulos de Terraform pre-auditados y
  certificados** (no generados por IA en el momento) que cumplan PCI-DSS/SOC2 real
  — aislamiento de red (VPC), cifrado KMS en reposo, bases de datos aisladas — y que
  el LLM solo rellene variables dentro de esos módulos ya certificados, nunca que
  decida los algoritmos de cifrado o el manejo de sesiones por su cuenta.
- Pipeline GitOps: push a GitHub/GitLab, CI/CD con runners dinámicos que ejecuten
  `docker build`, suban a un registro privado (AWS ECR), y apliquen Terraform/K8s
  para levantar el clúster real (EKS, GKE).

---

## 5. Orden de implementación sugerido cuando se active

1. Confirmar primero la decisión de la sección 1 (anuncio público sí/no, y si se
   invierte en módulos Terraform certificados de verdad antes de lanzar nada
   bancario).
2. Extender `GenLanguage` y añadir `targetBackendFramework` (Modificación 1) — esto
   es lo más barato y menos arriesgado de hacer primero.
3. Construir y probar la imagen E2B personalizada políglota (Modificación 2) —
   probar primero con Go o Python/FastAPI antes que con Java/Spring (más simple).
4. Solo después de tener 2 y 3 funcionando con un lenguaje no-Node real en
   producción, abordar Modificación 3 (IaC + despliegue real), empezando por
   Docker + un solo proveedor cloud, antes de soportar los tres (AWS/GCP/Azure).

---

## 6. Pregunta abierta que la otra IA hizo y que ya quedó respondida aquí

> "¿Cómo tenemos estructurado actualmente el script de construcción de entornos en
> el backend para la Live Preview? Si el entorno actual utiliza únicamente
> contenedores fijos de Node.js, pásame ese fragmento..."

Respuesta confirmada en la sección 0 de este documento: sí, es exclusivamente E2B
con plantilla Node.js por defecto, sin Dockerfile custom, y con dependencia dura de
`package.json`. El archivo relevante es `artifacts/api-server/src/lib/e2bValidator.ts`.
