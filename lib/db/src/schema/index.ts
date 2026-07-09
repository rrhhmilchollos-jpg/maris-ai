import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Users ───────────────────────────────────────────────────────────────────
export interface IUser {
  _id?: string;
  email: string;
  fullName?: string;
  imageUrl?: string;
  credits: number;
  stripeCustomerId?: string;
  isPremium?: boolean;
  isAdmin?: boolean;
  freeCreditsUsed?: boolean;
  hasEverPaid?: boolean;       // true en cuanto se confirma el primer pago (Stripe o Viva)
  // Emails de reactivación automática
  reactivationEmailsSent?: string[];
  lastReactivationEmailAt?: Date;
  reactivationUnsubscribed?: boolean;

  // ── Programa de afiliados ─────────────────────────────────────────────
  referralCode?: string;       // Código único de este usuario para compartir (ref=XXXX)
  referredBy?: string;         // userId del afiliado que lo trajo
  affiliateBalance?: number;   // Comisiones pendientes de cobro (en euros)
  affiliateTotalEarned?: number; // Total ganado como afiliado (histórico)
  affiliatePayoutRequested?: boolean; // Si ha solicitado cobro
  firstPaidAt?: Date;          // fecha del primer pago confirmado
  registrationIp?: string;
  lastLoginIp?: string;
  lastLoginAt?: Date;
  // Teléfono verificado vía Clerk (formato E.164, ej. "+34600123456") —
  // capturado y obligatorio desde el registro (configurado en el panel de
  // Clerk: User & authentication → Phone → "Required") para poder avisar
  // al cliente por WhatsApp en caso de incidencias reales, además del
  // correo electrónico. Se sincroniza desde Clerk en ensureUser() — Clerk
  // es la fuente de verdad de la verificación en sí (el OTP, el estado
  // verificado/no verificado), aquí solo guardamos una copia de trabajo
  // para poder consultarla directamente desde MongoDB sin llamar a la API
  // de Clerk cada vez (ej. al enviar la disculpa por WhatsApp desde el panel admin).
  phoneNumber?: string;
  // Moderación
  isSuspended?: boolean;
  suspendedAt?: Date;
  suspendReason?: string;
  isBanned?: boolean;
  bannedAt?: Date;
  banReason?: string;
  blockedIps?: string[];
  // Suscripción y plan
  plan?: string;
  planCredits?: number;
  planExpiresAt?: Date;
  // ENCONTRADO A PETICIÓN DEL USUARIO: Stripe en Maris AI solo debe existir
  // como capacidad que los agentes integran en las apps DE LOS CLIENTES
  // cuando lo piden -- nunca como sistema de facturación propio de Maris AI
  // (eso es Viva.com, en exclusiva). Este campo stripeSubscriptionId nunca
  // se llegó a asignar en ningún sitio del código real -- confirmado con
  // grep antes de eliminarlo, no era una suposición.
  // Viva.com — migración desde Stripe. La recurrencia de Viva NO usa un
  // objeto "Subscription" como Stripe: el primer pago se crea con
  // allowRecurring=true, y los cobros mensuales siguientes son
  // transacciones NUEVAS que referencian el transactionId de ESE primer
  // pago (ver lib/payments.ts → chargeRecurringPayment). Por eso aquí se
  // guarda el transactionId inicial, no un ID de "suscripción" como tal —
  // es la pieza que el cron mensual necesita para poder cobrar de nuevo.
  vivaInitialTransactionId?: string;
  vivaSourceCode?: string; // sourceCode usado en el pago inicial — el cobro recurrente debe usar el mismo
  vivaLastChargeAt?: Date; // último cobro recurrente exitoso — evita doble cobro el mismo ciclo
  // Notas de admin
  adminNotes?: Array<{ text: string; createdAt: Date }>;
  // GitHub OAuth
  githubAccessToken?: string;
  githubLogin?: string;
  githubId?: string;
  githubAvatarUrl?: string;
  githubConnectedAt?: Date;
  // Railway API token — propiedad del propio usuario, el backend de cada
  // app se despliega en SU cuenta de Railway, no en una compartida de
  // Maris AI. Se guarda igual que el resto de credenciales de servicios
  // externos del usuario (ver githubAccessToken arriba).
  railwayApiToken?: string;
  railwayConnectedAt?: Date;
  // ID Universal Maris AI — formato USR-<timestamp_base36>-<random6>
  // Identifica al usuario de forma única en todo el ecosistema de Maris AI
  marisId?: string;
  adminPatchedAt?: Date;
  adminPatchNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    fullName: { type: String },
    imageUrl: { type: String },
    // 65 = créditos de bienvenida. Debe coincidir SIEMPRE con el regalo del
    // clerkWebhook y con el marketing público ("65 créditos gratis").
    credits: { type: Number, default: 65, required: true },
    stripeCustomerId: { type: String },
    isPremium: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    freeCreditsUsed: { type: Boolean, default: false },
    hasEverPaid: { type: Boolean, default: false },
    // Emails de reactivación automática
    reactivationEmailsSent: { type: [String], default: [] },
    lastReactivationEmailAt: { type: Date },
    reactivationUnsubscribed: { type: Boolean, default: false },

    // Programa de afiliados
    referralCode: { type: String, sparse: true, index: true },
    referredBy: { type: String, index: true },
    affiliateBalance: { type: Number, default: 0 },
    affiliateTotalEarned: { type: Number, default: 0 },
    affiliatePayoutRequested: { type: Boolean, default: false },
    firstPaidAt: { type: Date },
    registrationIp: { type: String },
    lastLoginIp: { type: String },
    lastLoginAt: { type: Date },
    phoneNumber: { type: String },
    // Moderación
    isSuspended: { type: Boolean, default: false },
    suspendedAt: { type: Date },
    suspendReason: { type: String },
    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date },
    banReason: { type: String },
    blockedIps: { type: [String], default: [] },
    // Notas de admin
    adminNotes: { type: [{ text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
    // Suscripción y plan
    plan: { type: String, default: "free" },
    planCredits: { type: Number, default: 0 },
    planExpiresAt: { type: Date },
    // stripeSubscriptionId eliminado -- nunca se usó de verdad, ver
    // comentario junto a la interfaz TypeScript más arriba en este archivo.
    vivaInitialTransactionId: { type: String },
    vivaSourceCode: { type: String },
    vivaLastChargeAt: { type: Date },
    // GitHub OAuth
    githubAccessToken: { type: String },
    githubLogin: { type: String },
    githubId: { type: String },
    githubAvatarUrl: { type: String },
    githubConnectedAt: { type: Date },
    railwayApiToken: { type: String },
    railwayConnectedAt: { type: Date },
    // ID Universal Maris AI
    marisId: { type: String, unique: true, sparse: true, index: true },
    // Correcciones de soporte admin — inmutables desde el cliente
    adminPatchedAt: { type: Date },
    adminPatchNote: { type: String }, // Descripción interna del parche
  },
  { timestamps: true },
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

// ─── Generated Apps ──────────────────────────────────────────────────────────
export interface IGeneratedApp {
  _id?: string;
  userId: string;
  title: string;
  prompt: string;
  description: string;
  techStack: string[];
  frontendCode: string;
  backendCode: string;
  status: string;
  coderModel: string;
  language: string;
  kind?: string;
  publicSlug?: string;
  // Showcase público (galería /showcase): el usuario opta por mostrar este
  // proyecto en la galería pública de Maris AI. Solo se exponen campos
  // seguros (title, description, techStack, kind, enlace de demo).
  isPublic?: boolean;
  showcasePublishedAt?: Date;
  githubRepoUrl?: string;
  githubRepoFullName?: string;
  vercelDeployUrl?: string;
  vercelProjectId?: string;
  vercelCustomDomain?: string;
  // A petición explícita del usuario: ventana de gracia de re-deploy
  // gratuito. Se registra el momento del último deploy COBRADO (no de
  // cualquier deploy) — si el cliente vuelve a pulsar "Deploy" dentro de
  // los 5 minutos siguientes, ese re-deploy es gratis; pasada la ventana,
  // vuelve a cobrarse.
  lastPaidDeployAt?: Date;
  // A petición explícita del usuario: progreso REAL del deploy en vivo,
  // estilo Emergent.sh — instrumentado dentro de deployAppToVercel para
  // que cada fase del stepper corresponda a un punto verídico del proceso
  // real contra la API de Vercel, no a una animación con temporizadores
  // inventados. El frontend hace polling de estos campos mientras el
  // deploy está en curso.
  deployPhase?: "health_check" | "preparing_bundle" | "syncing_env" | "deploying" | "waiting_ready" | "final_check" | "done" | "error" | null;
  deployStartedAt?: Date;
  deployError?: string;
  autoPublish?: boolean;
  evaluatorSummary?: string;
  agentNotes?: string;
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
  hasWatermark?: boolean;
  watermarkRemovalPrice?: number;
  watermarkRemovalStripeSessionId?: string;
  watermarkRemovalVivaOrderCode?: number;
  // Preview en vivo (SSR) — para proyectos importados que necesitan un
  // servidor real corriendo (Next.js App Router, etc.), a diferencia del
  // resto de apps de Maris AI que se sirven como bundle estático via
  // buildDeployHtml. Ver lib/ssrImportBuilder.ts.
  renderMode?: "static" | "ssr-live";
  // Ver comentario junto a la definición del esquema Mongoose (más abajo)
  // -- HTML prerenderizado real de la home de la app, para servir a
  // crawlers en vez de la carcasa vacía de la SPA.
  prerenderedHomeHtml?: string;
  prerenderedAt?: Date;
  lastBuildErrorSummary?: string;
  livePreviewUrl?: string;
  livePreviewSandboxId?: string;
  livePreviewExpiresAt?: Date;
  // Proyecto original completo (JSON de { ruta: contenido }), SOLO para
  // renderMode==="ssr-live" -- necesario para poder reconstruir el
  // servidor cuando el sandbox muera (E2B lo mata solo al llegar a su
  // timeout, o si el usuario lo reinicia manualmente). Sin esto, un
  // sandbox muerto sería irrecuperable: no habría con qué reconstruirlo.
  importedSourceFilesJson?: string;
  // Estado de la importación en segundo plano -- a petición del usuario,
  // tras confirmar con la consola del navegador que una importación con
  // muchos reintentos (proyectos tipo Wix con dependencias problemáticas)
  // puede tardar tanto que algún proxy por el camino corta la conexión a
  // mitad, mostrando un confuso "error de CORS" en vez de indicar que
  // simplemente se ha tardado demasiado. Ahora el endpoint responde al
  // instante con este registro en "processing", y el trabajo pesado
  // (extraer, compilar en E2B con reintentos) corre en segundo plano,
  // actualizando estos campos cuando termina -- el frontend consulta el
  // estado por su cuenta en vez de esperar una única petición larga.
  importStatus?: "processing" | "ready" | "failed";
  importError?: string;
  importBuildLog?: string;
  importInstallLog?: string;
  deploymentStatus?: string;
  deploymentError?: string;
  marisaiSubdomain?: string;
  customDomain?: string;
  customDomainProvider?: string;
  customDomainVerified?: boolean;
  lastDeployedAt?: Date;
  deploymentLogs?: string;
  // Backend real desplegado en Railway (no solo el frontend a Vercel) —
  // ver lib/railwayDeploy.ts. railwayBackendUrl es la URL pública real que
  // el frontend usa para hacer fetch a su propio backend en producción.
  railwayProjectId?: string;
  railwayServiceId?: string;
  railwayEnvironmentId?: string;
  railwayBackendUrl?: string;
  railwayDeploymentStatus?: "not_deployed" | "deploying" | "deployed" | "failed";
  railwayDeploymentError?: string;
  // Arquitectura elegida por el Architect durante la generación — ENCONTRADO:
  // este campo solo vivía en el ProjectPlan en memoria, nunca se persistía,
  // así que tras la generación no había forma de saber si una app concreta
  // era "serverless" (backend ya viaja con el frontend a Vercel, nada que
  // desplegar a Railway) sin volver a inspeccionar el código generado.
  architecture?: "monolith" | "microservices" | "serverless";
  // A petición explícita del usuario: el cliente introduce sus propias API
  // keys/secrets (OpenAI, WhatsApp, etc.) para que la app generada se
  // conecte a servicios externos reales. "value" (legacy, NUNCA usar para
  // datos nuevos) se mantiene solo por compatibilidad con datos antiguos
  // sin cifrar — todo valor real nuevo va cifrado en "encryptedValue"
  // (AES-256-GCM, ver lib/secretsCrypto.ts). El descifrado solo ocurre en
  // el momento real del deploy, para inyectarlo en Vercel — nunca se
  // devuelve el valor real al frontend tras guardarse.
  requiredEnvVars?: Array<{ name: string; why: string; value?: string; encryptedValue?: string }>;
  // ID Universal Maris AI — formato PRJ-<timestamp_base36>-<random6>
  // Identifica al proyecto de forma única en todo el ecosistema de Maris AI
  marisId?: string;
  // Pre-Deployment Health Check — último resultado guardado
  lastHealthCheckAt?: Date;
  lastHealthCheckReport?: {
    ok: boolean;
    frontendIssues: Array<{ file: string; message: string; line?: number }>;
    backendIssues: Array<{ file: string; message: string; line?: number }>;
    repaired: boolean;
    checkedAt: Date;
  };
  // Flujo de soporte/reparación (admin recovery): cuando una app pasa por
  // /api/admin/jobs/:id/recover, se crea/actualiza marcada con
  // pendingAdminApproval=true — queda OCULTA para el cliente (GET /api/apps
  // la excluye) hasta que un admin la apruebe explícitamente vía
  // /api/admin/jobs/:id/approve-for-client. Las apps de generación NORMAL
  // (el 99% de los casos) nunca tocan este campo — por defecto es
  // false/undefined y se comportan exactamente igual que siempre.
  pendingAdminApproval?: boolean;
  pendingApprovalSince?: Date;
  approvedByAdminAt?: Date;
  // "Red de seguridad" de créditos gratis: si la primera app de un usuario
  // free sale con algo roto/incompleto, tiene derecho a UN reintento sin
  // coste (en vez de los 6 créditos normales) porque el fallo es del
  // sistema, no del usuario, y con solo 45-65 créditos de bienvenida no
  // hay margen para pagar el error de Maris AI. Se marca true la primera
  // vez que se usa para que no se pueda reclamar más de una vez por app.
  freeSafetyNetRetryUsed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedAppSchema = new Schema<IGeneratedApp>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    prompt: { type: String, required: true },
    description: { type: String, required: true },
    techStack: { type: [String], default: [] },
    frontendCode: { type: String, required: true },
    backendCode: { type: String, required: true },
    status: { type: String, default: "ready" },
    coderModel: { type: String, default: "auto" },
    language: { type: String, default: "typescript" },
    kind: { type: String, default: "fullstack" },
    publicSlug: { type: String, unique: true, sparse: true },
    isPublic: { type: Boolean, default: false, index: true },
    showcasePublishedAt: { type: Date },
    githubRepoUrl: { type: String },
    githubRepoFullName: { type: String },
    vercelDeployUrl: { type: String },
    vercelProjectId: { type: String },
    vercelCustomDomain: { type: String },
    lastPaidDeployAt: { type: Date },
    deployPhase: { type: String, default: null },
    deployStartedAt: { type: Date },
    deployError: { type: String },
    autoPublish: { type: Boolean, default: false },
    evaluatorSummary: { type: String },
    agentNotes: { type: String },
    plannedPages: [{ name: String, route: String, purpose: String }],
    hasWatermark: { type: Boolean, default: true },
    watermarkRemovalPrice: { type: Number, default: 9.99 },
    watermarkRemovalStripeSessionId: { type: String },
    watermarkRemovalVivaOrderCode: { type: Number },
    renderMode: { type: String, enum: ["static", "ssr-live"], default: "static" },
    // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de "contras" del vibe
    // coding, punto real y confirmado: las apps de clientes son SPAs sin
    // prerenderizado -- a diferencia de la propia web de Maris AI, que sí
    // lo tiene desde hace tiempo, las apps generadas para clientes nunca
    // tuvieron esto). HTML ya renderizado (via Puppeteer, reutilizando
    // launchBrowser() de visualTester.ts) de la página de inicio real de
    // la app desplegada -- se sirve a crawlers conocidos (Googlebot,
    // GPTBot, etc.) en vez de la carcasa vacía de la SPA, sin afectar a
    // usuarios reales, que siguen recibiendo la app interactiva normal.
    prerenderedHomeHtml: { type: String },
    prerenderedAt: { type: Date },
    // ENCONTRADO A PETICIÓN DEL USUARIO (revisión honesta del build real):
    // cuando el build real en E2B falla y la reparación automática tampoco
    // lo arregla, antes se entregaba la app en silencio, sin avisar al
    // cliente. Este campo guarda el error real (texto legible, no la
    // traza cruda) para poder mostrarlo en la vista previa y en el chat.
    lastBuildErrorSummary: { type: String },
    livePreviewUrl: { type: String },
    livePreviewSandboxId: { type: String },
    livePreviewExpiresAt: { type: Date },
    importedSourceFilesJson: { type: String },
    importStatus: { type: String, enum: ["processing", "ready", "failed"] },
    importError: { type: String },
    importBuildLog: { type: String },
    importInstallLog: { type: String },
    deploymentStatus: { type: String, default: "not_deployed", enum: ["not_deployed", "deploying", "deployed", "failed"] },
    deploymentError: { type: String },
    marisaiSubdomain: { type: String, unique: true, sparse: true },
    customDomain: { type: String },
    customDomainProvider: { type: String },
    customDomainVerified: { type: Boolean, default: false },
    lastDeployedAt: { type: Date },
    deploymentLogs: { type: String },
    railwayProjectId: { type: String },
    railwayServiceId: { type: String },
    railwayEnvironmentId: { type: String },
    railwayBackendUrl: { type: String },
    railwayDeploymentStatus: { type: String, default: "not_deployed", enum: ["not_deployed", "deploying", "deployed", "failed"] },
    railwayDeploymentError: { type: String },
    architecture: { type: String, enum: ["monolith", "microservices", "serverless"] },
    requiredEnvVars: [
      {
        name: { type: String, required: true },
        why: { type: String },
        value: { type: String },
        encryptedValue: { type: String },
      },
    ],
    // ID Universal Maris AI
    marisId: { type: String, unique: true, sparse: true, index: true },
    // Pre-Deployment Health Check
    lastHealthCheckAt: { type: Date },
    lastHealthCheckReport: {
      type: new Schema(
        {
          ok: { type: Boolean, required: true },
          frontendIssues: { type: [{ file: String, message: String, line: Number }], default: [] },
          backendIssues: { type: [{ file: String, message: String, line: Number }], default: [] },
          repaired: { type: Boolean, default: false },
          checkedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: false,
    },
    // Flujo de soporte/reparación — por defecto false/ausente, no afecta a
    // la generación normal de apps.
    pendingAdminApproval: { type: Boolean, default: false, index: true },
    pendingApprovalSince: { type: Date },
    approvedByAdminAt: { type: Date },
    freeSafetyNetRetryUsed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Índices para queries frecuentes de ordenación y filtrado
GeneratedAppSchema.index({ createdAt: -1 });
GeneratedAppSchema.index({ userId: 1, createdAt: -1 });
GeneratedAppSchema.index({ updatedAt: -1 });

export const GeneratedApp: Model<IGeneratedApp> =
  mongoose.models.GeneratedApp ||
  mongoose.model<IGeneratedApp>("GeneratedApp", GeneratedAppSchema);

// ─── Credit Transactions ─────────────────────────────────────────────────────
export interface ICreditTransaction extends Document {
  userId: string;
  kind: string;
  type?: string;         // alias de kind para compatibilidad con código de afiliados
  amount: number;
  description: string;
  stripeSessionId?: string;
  vivaOrderCode?: string;
  // ENCONTRADO (a petición del usuario, tras no poder rastrear un cargo
  // real de 20€): creditPurchase() nunca guardaba el importe en euros del
  // pago, solo los créditos añadidos -- por eso "Ingresos totales" en el
  // panel admin mostraba 0€ SIEMPRE, para todas las compras, no solo la
  // de este caso. Campos nuevos para que cada transacción sea auditable
  // y reembolsable de verdad:
  priceCents?: number;         // importe real cobrado, en céntimos de euro
  status?: string;             // "succeeded" | "refunded" | "failed"
  gateway?: string;            // "viva" | "stripe" | "legacy"
  vivaTransactionId?: string;  // TransactionId real de Viva (distinto de vivaOrderCode) -- necesario para reembolsar vía su API
  cardLast4?: string;
  cardBrand?: string;
  refundedAt?: Date;
  refundedBy?: string;         // userId del admin que ejecutó el reembolso
  refundReason?: string;
  affiliateAmount?: number;  // importe en euros de la comisión de afiliado
  relatedUserId?: string;    // userId del referido que generó la comisión
  createdAt: Date;
  updatedAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: { type: String, required: true, index: true },
    kind: { type: String },
    type: { type: String },  // alias para comisiones de afiliado
    amount: { type: Number, default: 0 },
    description: { type: String, required: true },
    stripeSessionId: { type: String },
    vivaOrderCode: { type: String },
    priceCents: { type: Number },
    status: { type: String, enum: ["succeeded", "refunded", "failed"], default: "succeeded" },
    gateway: { type: String, enum: ["viva", "stripe", "legacy"] },
    vivaTransactionId: { type: String, index: true },
    cardLast4: { type: String },
    cardBrand: { type: String },
    refundedAt: { type: Date },
    refundedBy: { type: String },
    refundReason: { type: String },
    affiliateAmount: { type: Number },
    relatedUserId: { type: String },
  },
  { timestamps: true },
);

export const CreditTransaction: Model<ICreditTransaction> =
  mongoose.models.CreditTransaction ||
  mongoose.model<ICreditTransaction>("CreditTransaction", CreditTransactionSchema);

// ─── Generation Jobs ─────────────────────────────────────────────────────────
export interface IGenerationJob extends Document {
  userId: string;
  prompt: string;
  status: string;
  phase: string;
  progress: number;
  appId?: string;
  errorMessage?: string;
  // A petición explícita del usuario: el mensaje técnico crudo (ej. el
  // texto literal de Anthropic "Your credit balance is too low...") NUNCA
  // debe llegar a la pantalla del cliente — solo se guarda aquí, visible
  // únicamente en el panel de admin, para que el equipo pueda diagnosticar
  // el problema real sin exponerlo al cliente.
  internalErrorMessage?: string;
  // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de calidad de la primera
  // generación): el Testing Agent (tester.ts) sabe internamente cuando se
  // agotan los 5 ciclos de reparación SIN resolver todos los problemas
  // detectados -- pero esa información solo se escribía en un log interno
  // del servidor y se perdía por completo al devolver el resultado. El
  // cliente recibía su app marcada como "lista" sin ningún indicio de que
  // quedaron problemas conocidos sin resolver. Este campo permite que
  // tester.ts deje constancia real de esto en el propio job.
  hasKnownQualityIssues?: boolean;
  knownQualityIssuesSummary?: string;
  currentAgent?: string;
  awaitingApproval?: boolean;
  approvedFacets?: string[];
  // A petición explícita del usuario (caso real confirmado: decenas de
  // jobs "autopilot-quality"/"autopilot-fix" encadenados sin fin contra el
  // mismo cliente, saturando la cola). autoFixedFromJobId ya existía
  // (referenciaba solo al padre INMEDIATO, sin protección real contra
  // cadenas largas). repairChainDepth es NUEVO: se hereda +1 del job padre
  // en cada reparación automática encadenada, permitiendo bloquear la
  // cadena completa cuando supera MAX_AUTO_REPAIR_CHAIN_DEPTH, en vez de
  // solo evitar re-diagnosticar el mismo job dos veces (que no detenía la
  // cadena, solo evitaba un bucle de UN job consigo mismo).
  autoFixedFromJobId?: string;
  repairChainDepth?: number;
  autoDiagnosed?: boolean;
  // ENCONTRADO A PETICIÓN DEL USUARIO (caso real confirmado con capturas
  // del propio panel de notificaciones: DOCENAS de avisos duplicados
  // "detectamos un problema" / "arreglado, +10 créditos" para las MISMAS
  // 2 apps, una tras otra). Causa raíz DISTINTA de repairChainDepth (que
  // protege cadenas de jobs que se reparan unos a otros): aquí
  // autoFixBrokenApps() (aiAutopilot.ts) solo comprobaba si HABÍA un job
  // de arreglo AHORA MISMO en cola/corriendo -- en cuanto ese job
  // terminaba (arreglara el problema de verdad o no), la comprobación
  // dejaba de detectarlo, y si la app seguía "pareciendo sospechosa"
  // (menos de 5KB), el siguiente ciclo (cada 10 min) lanzaba OTRO intento
  // nuevo, con OTRA notificación y OTROS 10 créditos de "compensación" --
  // indefinidamente, sin límite. Este campo cuenta los intentos reales
  // por APP (no por cadena de jobs), para poder parar tras un número
  // razonable en vez de repetir para siempre.
  autopilotFixAttempts?: number;
  autoDiagnosisNote?: string;
  checkpointData?: any;
  editAppId?: string;
  // Job lanzado automáticamente porque la vista previa no renderizó nada
  // (detectado vía postMessage desde el iframe). No cuesta créditos, y al
  // terminar (éxito o fallo) se publica un AppMessage avisando al usuario.
  isAutoRepair?: boolean;
  // Job generado por la demo pública (visitante sin registro).
  isDemo?: boolean;
  // Si true, el admin generó esta app saltando las preguntas de clarificación
  // técnica (gating). El cliente verá la app directamente sin responder nada.
  skipGating?: boolean;
  // forceBasicGeneration: el admin puede forzar scope-cut de 7 hitos
  // aunque el job tenga hasEverPaid:true. Para recuperar clientes free.
  forceBasicGeneration?: boolean;
  // A petición explícita del usuario: jobs de "Revisión profunda de errores"
  // (Testing Agent bajo demanda, 30 créditos, disparado por el cliente desde
  // un botón en su app ya generada) usan jobKind="deep_test" en vez del flujo
  // normal de generación/edición. runJobById bifurca al inicio según este
  // campo — el resto de la infraestructura (cola, heartbeat, logs en vivo,
  // panel de diagnóstico) se reutiliza sin cambios.
  jobKind?: "generation" | "deep_test";
  coderModel: string;
  language: string;
  kind: string;
  attachmentIds: number[];
  isAdmin: boolean;
  hasEverPaid?: boolean;
  retryCount: number;
  // ENCONTRADO: el bloque de reembolso automático (catch de runJobById, más
  // abajo en apps.ts) llevaba tiempo leyendo `job.creditsCost` para saber
  // cuánto devolver si la generación fallaba por error del sistema — pero
  // este campo nunca se guardaba al crear el job, así que el reembolso
  // automático NUNCA se ejecutaba de verdad (siempre caía al `?? 0`). El
  // cliente perdía créditos por fallos que no eran su culpa, sin ningún
  // reembolso real pese a que el código "parecía" tenerlo cubierto.
  creditsCost?: number;
  workerId?: string | null;
  partialFrontendCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const GenerationJobSchema = new Schema<IGenerationJob>(
  {
    userId: { type: String, required: true, index: true },
    prompt: { type: String, required: true },
    status: { type: String, default: "queued" },
    phase: { type: String, default: "queued" },
    progress: { type: Number, default: 0 },
    appId: { type: String },
    errorMessage: { type: String },
    internalErrorMessage: { type: String },
    hasKnownQualityIssues: { type: Boolean, default: false },
    knownQualityIssuesSummary: { type: String },
    currentAgent: { type: String },
    awaitingApproval: { type: Boolean, default: false },
    approvedFacets: { type: [String], default: [] },
    autoFixedFromJobId: { type: String },
    autopilotFixAttempts: { type: Number },
    repairChainDepth: { type: Number, default: 0 },
    autoDiagnosed: { type: Boolean, default: false },
    autoDiagnosisNote: { type: String },
    isDemo: { type: Boolean, default: false, index: true },
    skipGating: { type: Boolean, default: false },
    forceBasicGeneration: { type: Boolean, default: false },
    checkpointData: { type: Schema.Types.Mixed },
    editAppId: { type: String },
    isAutoRepair: { type: Boolean, default: false },
    jobKind: { type: String, default: "generation" },
    coderModel: { type: String, default: "auto" },
    language: { type: String, default: "typescript" },
    kind: { type: String, default: "fullstack" },
    attachmentIds: { type: [Number], default: [] },
    isAdmin: { type: Boolean, default: false },
    hasEverPaid: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },
    creditsCost: { type: Number, default: 0 },
    workerId: { type: String },
    partialFrontendCode: { type: String },
  },
  { timestamps: true },
);

export const GenerationJob: Model<IGenerationJob> =
  mongoose.models.GenerationJob ||
  mongoose.model<IGenerationJob>("GenerationJob", GenerationJobSchema);

// ─── Visual Test Jobs ────────────────────────────────────────────────────────
// ENCONTRADO en logs reales de producción: el ciclo de Testing Visual +
// Autofix (POST /apps/:id/visual-test) se ejecutaba de forma SÍNCRONA —
// el cliente esperaba con la conexión HTTP abierta mientras Claude Vision
// analizaba y CoreOrchestrator reconstruía hasta 3 ciclos. Confirmado con
// responseTime de hasta 300010ms (abortado) y 292507ms (al límite) en los
// logs de Railway — su proxy corta conexiones a los 5 minutos por
// defecto, perdiendo todo el trabajo en curso aunque el servidor sí
// estuviera procesando bien. Este job, igual de simple que GenerationJob
// pero sin necesidad de cola con concurrencia (cada visual-test es
// puntual, no hay volumen comparable a generaciones), permite responder
// al cliente AL INSTANTE con un jobId, lanzar el trabajo real en segundo
// plano (sin atar la respuesta HTTP a su duración), y que el frontend
// haga polling del resultado — mismo patrón ya probado en producción para
// GenerationJob, sin inventar un mecanismo nuevo.
export interface IVisualTestJob extends Document {
  appId: string;
  userId: string;
  autoFix: boolean;
  status: "running" | "succeeded" | "failed";
  result?: any; // mismo shape que la respuesta JSON que el endpoint devolvía antes de forma síncrona
  errorMessage?: string;
  /** ENCONTRADO en un video real del usuario: el frontend simulaba el
   *  progreso con 7 mensajes fijos cada 4s (28s totales) que se quedaban
   *  congelados en el último cuando el ciclo real (varias rondas de
   *  CoreOrchestrator) tardaba más — el usuario veía "Verificando
   *  mejoras..." fijo durante minutos sin relación con el trabajo real.
   *  Este campo se actualiza en vivo desde runVisualTester (ver
   *  visualTester.ts → onProgress) para que el polling del frontend
   *  muestre la fase REAL en curso, no una simulación. */
  progressNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VisualTestJobSchema = new Schema<IVisualTestJob>(
  {
    appId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    autoFix: { type: Boolean, default: false },
    status: { type: String, default: "running" },
    result: { type: Schema.Types.Mixed },
    errorMessage: { type: String },
    progressNote: { type: String },
  },
  { timestamps: true },
);

export const VisualTestJob: Model<IVisualTestJob> =
  mongoose.models.VisualTestJob ||
  mongoose.model<IVisualTestJob>("VisualTestJob", VisualTestJobSchema);

// ─── App Messages ────────────────────────────────────────────────────────────
export interface IAppMessage extends Document {
  appId: string;
  role: string;
  content: string;
  attachmentIds: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppMessageSchema = new Schema<IAppMessage>(
  {
    appId: { type: String, required: true, index: true },
    role: { type: String, required: true },
    content: { type: String, required: true },
    attachmentIds: { type: String, default: "[]" },
  },
  { timestamps: true },
);

export const AppMessage: Model<IAppMessage> =
  mongoose.models.AppMessage ||
  mongoose.model<IAppMessage>("AppMessage", AppMessageSchema);

// ─── User Notifications (soporte admin → cliente) ────────────────────────────
export interface IUserNotification extends Document {
  userId: string;
  appId?: string;
  appTitle?: string;
  type: string;       // "support_patch" | "support_regen" | "support_message"
  message: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserNotificationSchema = new Schema<IUserNotification>(
  {
    userId: { type: String, required: true, index: true },
    appId:  { type: String },
    appTitle: { type: String },
    type:   { type: String, required: true, default: "support_patch" },
    message: { type: String, required: true },
    read:   { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export const UserNotification: Model<IUserNotification> =
  mongoose.models.UserNotification ||
  mongoose.model<IUserNotification>("UserNotification", UserNotificationSchema);

// ─── App Images ──────────────────────────────────────────────────────────────
export interface IAppImage extends Document {
  appId: string;
  mimeType: string;
  data: string;
  altText: string;
  originalUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppImageSchema = new Schema<IAppImage>(
  {
    appId: { type: String, required: true, index: true },
    mimeType: { type: String, required: true },
    data: { type: String, required: true },
    altText: { type: String, default: "" },
    originalUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

export const AppImage: Model<IAppImage> =
  mongoose.models.AppImage ||
  mongoose.model<IAppImage>("AppImage", AppImageSchema);

// ─── Job Logs ────────────────────────────────────────────────────────────────
export interface IJobLog extends Document {
  jobId: string;
  level: string;
  agent: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

const JobLogSchema = new Schema<IJobLog>(
  {
    jobId: { type: String, required: true, index: true },
    level: { type: String, default: "info" },
    agent: { type: String, required: true },
    message: { type: String, required: true },
  },
  { timestamps: true },
);

export const JobLog: Model<IJobLog> =
  mongoose.models.JobLog ||
  mongoose.model<IJobLog>("JobLog", JobLogSchema);

// ─── Chat Attachments ────────────────────────────────────────────────────────
export interface IChatAttachment extends Document {
  userId: string;
  appId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatAttachmentSchema = new Schema<IChatAttachment>(
  {
    userId: { type: String, required: true, index: true },
    appId: { type: String },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    dataBase64: { type: String, required: true },
  },
  { timestamps: true },
);

export const ChatAttachment: Model<IChatAttachment> =
  mongoose.models.ChatAttachment ||
  mongoose.model<IChatAttachment>("ChatAttachment", ChatAttachmentSchema);

// ─── Agent Memory ────────────────────────────────────────────────────────────
export interface IAgentMemory extends Document {
  errorMessage: string;
  errorContext?: string;
  patch: string;
  language: string;
  framework?: string;
  embedding?: number[];
  // Cuántas veces se ha reutilizado este parche ante un error casi idéntico
  // (ver rememberPatch() en artifacts/api-server/src/lib/agentMemory.ts).
  // Antes no estaba declarado aquí: Mongoose en modo estricto (por defecto)
  // descartaba el campo silenciosamente en cada $inc, así que
  // recallSimilar() — que filtra por successCount >= minSuccessCount — no
  // encontraba NUNCA ningún resultado en producción.
  successCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemorySchema = new Schema<IAgentMemory>(
  {
    errorMessage: { type: String, required: true },
    errorContext: { type: String },
    patch: { type: String, required: true },
    language: { type: String, default: "typescript" },
    framework: { type: String },
    embedding: { type: [Number] },
    successCount: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const AgentMemory: Model<IAgentMemory> =
  mongoose.models.AgentMemory ||
  mongoose.model<IAgentMemory>("AgentMemory", AgentMemorySchema);

// ─── Project Playbooks — memoria de PATRONES DE PROYECTO, no de errores ─────
// A petición explícita del usuario ("aprender como Emergent.sh... cueste lo
// que cueste"): AgentMemory aprende "error → parche", pero nunca aprende qué
// ESTRUCTURA y qué patrones funcionan bien para un tipo de negocio concreto
// de un proyecto a otro. Esta colección es la pieza nueva: cuando un
// proyecto termina con calidad alta confirmada (PM Agent / evaluador
// visual), se destila (con un modelo barato) qué funcionó a nivel
// estructural -- páginas, funcionalidades, patrones de panel de gestión --
// NUNCA el código en sí (no es reutilizable entre negocios distintos, y
// guardarlo infla la colección sin aportar nada extra sobre el resumen).
// Ver lib/projectPlaybooks.ts.
export interface IProjectPlaybook extends Document {
  businessVertical: string;
  kind: string;
  summary: string;
  sourceAppId: string;
  qualityScore: number;
  timesReused: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectPlaybookSchema = new Schema<IProjectPlaybook>(
  {
    businessVertical: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    summary: { type: String, required: true },
    sourceAppId: { type: String, required: true },
    qualityScore: { type: Number, required: true },
    timesReused: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const ProjectPlaybook: Model<IProjectPlaybook> =
  mongoose.models.ProjectPlaybook ||
  mongoose.model<IProjectPlaybook>("ProjectPlaybook", ProjectPlaybookSchema);

// ─── App Runtime Errors ──────────────────────────────────────────────────────
export interface IAppRuntimeError extends Document {
  appId: string;
  kind: string;
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  userAgent?: string;
  pathname?: string;
  // UNIFICADO: estos tres campos vivían SOLO en una definición DUPLICADA de
  // este mismo modelo dentro de autoRepairAgent.ts (mismo nombre de
  // colección Mongoose "AppRuntimeError", registrada por separado vía
  // mongoose.models.AppRuntimeError || mongoose.model(...) — quien se
  // registrara primero en el proceso "ganaba", dejando al otro import
  // operando contra un tipo TypeScript incompleto que no reflejaba los
  // campos reales ya en uso en producción). Encontrado al conectar la
  // lectura de errores reales al flujo de edición — unificado aquí en el
  // schema central; autoRepairAgent.ts ahora importa este mismo modelo en
  // vez de duplicar su propia definición.
  slug?: string;
  count?: number;
  repaired?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AppRuntimeErrorSchema = new Schema<IAppRuntimeError>(
  {
    appId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    message: { type: String, required: true },
    source: { type: String },
    lineno: { type: Number },
    colno: { type: Number },
    stack: { type: String },
    userAgent: { type: String },
    pathname: { type: String },
    slug: { type: String, index: true },
    count: { type: Number, default: 1 },
    repaired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const AppRuntimeError: Model<IAppRuntimeError> =
  mongoose.models.AppRuntimeError ||
  mongoose.model<IAppRuntimeError>("AppRuntimeError", AppRuntimeErrorSchema);

// ─── Panel Runtime Errors ────────────────────────────────────────────────────
// ENCONTRADO a petición del usuario: un error de React en el panel de admin
// del propio Maris AI ("Error de autenticación... el sistema de
// autenticación no pudo cargarse") resultó ser un mensaje ENGAÑOSO — el
// ErrorBoundary global (error-boundary.tsx) etiqueta como "error de Clerk"
// CUALQUIER excepción cuyo stack mencione la palabra "clerk", lo cual es
// casi cualquier componente de la app (casi todos importan hooks de Clerk
// en algún punto del árbol). Sin logging real en producción, no había
// forma de ver el error EXACTO sin reproducirlo en vivo. Distinto de
// AppRuntimeError (que es para errores de las apps GENERADAS por los
// clientes) — este modelo es para errores del propio producto Maris AI.
export interface IPanelRuntimeError extends Document {
  userId?: string;
  message: string;
  stack?: string;
  componentStack?: string;
  pathname?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PanelRuntimeErrorSchema = new Schema<IPanelRuntimeError>(
  {
    userId: { type: String, index: true },
    message: { type: String, required: true },
    stack: { type: String },
    componentStack: { type: String },
    pathname: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

export const PanelRuntimeError: Model<IPanelRuntimeError> =
  mongoose.models.PanelRuntimeError ||
  mongoose.model<IPanelRuntimeError>("PanelRuntimeError", PanelRuntimeErrorSchema);

// ─── Agent Notes (user preferences + app notes) ───────────────────────────────
export interface IAgentNote extends Document {
  userId: string;
  notes: string;
  // ENCONTRADO A PETICIÓN DEL USUARIO (auditoría de onboarding): la
  // pantalla de onboarding llevaba tiempo intentando guardar estos dos
  // campos en PUT /me/preferences, pero el endpoint solo entendía
  // "notes" -- la petición fallaba siempre con 400, en silencio (el
  // try/catch de la pantalla se lo tragaba). El check verde de "Tipo de
  // proyecto seleccionado" en el paso 3 del onboarding confirmaba algo
  // que nunca se guardaba de verdad. Añadidos aquí, en la misma
  // colección de preferencias por usuario que ya existía.
  preferredAppType?: string;
  onboardingCompleted?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AgentNoteSchema = new Schema<IAgentNote>(
  {
    userId: { type: String, required: true, unique: true },
    notes: { type: String, default: "" },
    preferredAppType: { type: String },
    onboardingCompleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const AgentNote: Model<IAgentNote> =
  mongoose.models.AgentNote ||
  mongoose.model<IAgentNote>("AgentNote", AgentNoteSchema);

// ─── App Revisions ───────────────────────────────────────────────────────────
export interface IAppRevision extends Document {
  appId: string;
  source: string;
  summary?: string;
  frontendCode: string;
  backendCode: string;
  jobId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppRevisionSchema = new Schema<IAppRevision>(
  {
    appId: { type: String, required: true, index: true },
    source: { type: String, required: true },
    summary: { type: String },
    frontendCode: { type: String, required: true },
    backendCode: { type: String, required: true },
    jobId: { type: String },
  },
  { timestamps: true },
);

export const AppRevision: Model<IAppRevision> =
  mongoose.models.AppRevision ||
  mongoose.model<IAppRevision>("AppRevision", AppRevisionSchema);

// ─── Aliases en minúscula para compatibilidad ────────────────────────────────
export const AppImages = AppImage; // Mongoose alias
export const AppRuntimeErrors = AppRuntimeError; // Mongoose alias (use Drizzle appRuntimeErrors for ORM queries)
// generatedApps is exported as Drizzle table below (Mongoose model is GeneratedApp)

// ─── Support Tickets ─────────────────────────────────────────────────────────
export interface ITicket extends Document {
  userId: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'closed';
  category: 'general' | 'account_deletion' | 'refund';
  refundRequest?: {
    amountText?: string; // lo que el cliente indica (importe/motivo en texto libre)
    stripeChargeId?: string; // opcional, si el admin lo añade al aprobar
  };
  resolution?: {
    action: 'approved' | 'denied';
    byAdminId: string;
    at: Date;
    note?: string;
  };
  responses: Array<{
    senderId: string;
    message: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
  // ENCONTRADO A PETICIÓN DEL USUARIO (red de seguridad real para la
  // promesa de "respuesta en menos de 3-4 horas" ahora visible en 5
  // páginas públicas): evita mandar el mismo aviso de "ticket sin
  // responder" cada 5 minutos para siempre -- mismo tipo de bucle que
  // ya se corrigió antes hoy en aiAutopilot.ts.
  staleReminderSentAt?: Date;
}

const TicketSchema = new Schema<ITicket>(
  {
    userId: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_progress', 'closed'], default: 'open' },
    category: { type: String, enum: ['general', 'account_deletion', 'refund'], default: 'general', index: true },
    refundRequest: {
      amountText: { type: String },
      stripeChargeId: { type: String },
    },
    resolution: {
      action: { type: String, enum: ['approved', 'denied'] },
      byAdminId: { type: String },
      at: { type: Date },
      note: { type: String },
    },
    responses: [
      {
        senderId: { type: String, required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    staleReminderSentAt: { type: Date },
  },
  { timestamps: true },
);

export const Ticket: Model<ITicket> =
  mongoose.models.Ticket || mongoose.model<ITicket>('Ticket', TicketSchema);

// ─── Reviews (reseñas públicas, alimentan aggregateRating en schema.org) ────
// Flujo: usuario deja reseña -> pasa por filtro de palabras prohibidas
// (containsBannedWords en lib/reviewModeration.ts) -> si no salta el filtro
// queda "pending" para aprobación manual del admin -> al aprobarse pasa a
// "published" y solo entonces cuenta en el aggregateRating expuesto en el
// JSON-LD de marisai.es. Si salta el filtro queda "flagged" y no se muestra
// nunca automáticamente, requiere revisión manual explícita.
export type ReviewStatus = "pending" | "published" | "flagged" | "rejected";

export interface IReview extends Document {
  userId?: string;          // opcional: reseña puede venir de invitación por email sin cuenta logueada
  authorName: string;
  authorEmail?: string;
  rating: number;           // 1-5
  title?: string;
  body: string;
  status: ReviewStatus;
  flaggedWords?: string[];  // qué términos del filtro dispararon el flag, para revisión rápida del admin
  source?: string;          // "email_invite" | "dashboard" | "post_generation" etc.
  relatedAppId?: string;    // referencia a la app que generó, si aplica
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    userId: { type: String, index: true },
    authorName: { type: String, required: true },
    authorEmail: { type: String },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String },
    body: { type: String, required: true },
    status: { type: String, enum: ["pending", "published", "flagged", "rejected"], default: "pending", index: true },
    flaggedWords: { type: [String], default: [] },
    source: { type: String, default: "dashboard" },
    relatedAppId: { type: String, ref: "GeneratedApp" },
  },
  { timestamps: true },
);

export const Review: Model<IReview> =
  mongoose.models.Review || mongoose.model<IReview>("Review", ReviewSchema);

// ─── News Articles ───────────────────────────────────────────────────────────
export interface INewsArticle extends Document {
  title: string;
  slug: string;
  imageUrl: string;
  imageAlt?: string;
  body: string;
  author: string;
  publishedAt: Date;
  tags: string[];
  isFeatured: boolean;
  metaDescription?: string;
  relatedAppId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NewsArticleSchema = new Schema<INewsArticle>(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    imageUrl: { type: String, required: true },
    imageAlt: { type: String },
    body: { type: String, required: true },
    author: { type: String, required: true, default: "Maris AI" },
    publishedAt: { type: Date, default: Date.now },
    tags: { type: [String], default: [] },
    isFeatured: { type: Boolean, default: false },
    metaDescription: { type: String },
    relatedAppId: { type: String, ref: "GeneratedApp" },
  },
  { timestamps: true },
);

export const NewsArticle: Model<INewsArticle> =
  mongoose.models.NewsArticle || mongoose.model<INewsArticle>("NewsArticle", NewsArticleSchema);

// ─── Workflows (motor de automatización visual, tipo n8n, por app) ──────────
// Cada app generada puede tener sus propios flujos privados — disparador
// (evento de negocio o webhook entrante) → nodos de acción/condición/bucle/
// transformación → efectos (llamar URL externa, webhook saliente ya
// existente, email, etc.). El grafo en sí (nodos + conexiones) se guarda como
// JSON flexible porque su forma evoluciona con el editor visual; los campos
// de control (estado, app, nombre) sí están tipados para poder indexar y
// filtrar sin tener que parsear el JSON.
export type WorkflowNodeType =
  | "trigger" | "action" | "condition" | "loop" | "transform" | "delay" | "webhook-out";

export interface IWorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>; // forma específica según el tipo de nodo — validada en el motor de ejecución, no aquí, para no acoplar el esquema de DB a cada tipo de nodo
}

export interface IWorkflowEdge {
  id: string;
  source: string; // id de IWorkflowNode
  target: string;
  sourceHandle?: string; // para nodos con múltiples salidas (ej. condition: "true"/"false"; loop: "each"/"done")
}

export interface IWorkflow extends Document {
  appId: string; // referencia a GeneratedApp — los flujos son privados por app, nunca compartidos entre apps de distintos usuarios
  userId: string;
  name: string;
  description?: string;
  active: boolean;
  nodes: IWorkflowNode[];
  edges: IWorkflowEdge[];
  triggerEventType?: string; // ej. "pedido.creado" — coincide con los eventType de dispatchWebhookEvent ya generados en el backend de la app
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowSchema = new Schema<IWorkflow>(
  {
    appId: { type: String, required: true, ref: "GeneratedApp", index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    active: { type: Boolean, default: false },
    nodes: { type: [{ type: Schema.Types.Mixed }], default: [] },
    edges: { type: [{ type: Schema.Types.Mixed }], default: [] },
    triggerEventType: { type: String },
  },
  { timestamps: true },
);

export const Workflow: Model<IWorkflow> =
  mongoose.models.Workflow || mongoose.model<IWorkflow>("Workflow", WorkflowSchema);

// ─── Workflow Runs (historial de ejecuciones, para depuración real) ─────────
export interface IWorkflowNodeRunLog {
  nodeId: string;
  status: "success" | "error" | "skipped";
  startedAt: Date;
  finishedAt?: Date;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface IWorkflowRun extends Document {
  workflowId: string;
  appId: string;
  status: "running" | "success" | "error";
  triggerPayload?: unknown;
  nodeLogs: IWorkflowNodeRunLog[];
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

const WorkflowRunSchema = new Schema<IWorkflowRun>(
  {
    workflowId: { type: String, required: true, ref: "Workflow", index: true },
    appId: { type: String, required: true, index: true },
    status: { type: String, enum: ["running", "success", "error"], default: "running" },
    triggerPayload: { type: Schema.Types.Mixed },
    nodeLogs: { type: [{ type: Schema.Types.Mixed }], default: [] },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true },
);

export const WorkflowRun: Model<IWorkflowRun> =
  mongoose.models.WorkflowRun || mongoose.model<IWorkflowRun>("WorkflowRun", WorkflowRunSchema);

// ─── Pinned Packages (auto-pinning dinámico del Preview/Deploy) ──────────────
// Caché persistente de versiones exactas de paquetes npm que NO están en el
// mapa estático DEFAULT_VERSIONS de deployBundle.ts. Cuando un bundle generado
// por la IA importa un paquete fuera del catálogo, el sistema lo resuelve
// contra registry.npmjs.org, lo smoke-testea contra esm.sh y guarda aquí el
// resultado — así la siguiente app que use ese paquete resuelve al instante
// y SIEMPRE a una versión verificada, nunca a un "latest" sin garantía.
export type PinStatus = "verified" | "failed";

export interface IPinnedPackage extends Document {
  name: string;          // nombre del paquete npm (p.ej. "@tanstack/react-table")
  version: string;       // versión exacta pineada (p.ej. "8.20.5") — vacía si failed
  status: PinStatus;
  // Detalle del smoke test contra esm.sh (código HTTP o mensaje de error).
  smokeTestDetail?: string;
  verifiedAt?: Date;     // cuándo pasó el smoke test
  failedAt?: Date;       // cuándo falló (los failed se reintentan pasado el TTL)
  hitCount: number;      // nº de bundles que han resuelto contra esta entrada
  createdAt?: Date;
  updatedAt?: Date;
}

const PinnedPackageSchema = new Schema<IPinnedPackage>(
  {
    name: { type: String, required: true, unique: true, index: true },
    version: { type: String, default: "" },
    status: { type: String, enum: ["verified", "failed"], required: true },
    smokeTestDetail: { type: String },
    verifiedAt: { type: Date },
    failedAt: { type: Date },
    hitCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "pinned_packages" },
);

export const PinnedPackage: Model<IPinnedPackage> =
  mongoose.models.PinnedPackage ||
  mongoose.model<IPinnedPackage>("PinnedPackage", PinnedPackageSchema);

// ─── Connector Credentials (ecosistema de integraciones estilo Emergent) ─────
// Credenciales de conectores externos (Slack, Notion, Airtable, Resend…)
// guardadas POR USUARIO y SIEMPRE cifradas (AES-256-GCM, ver
// api-server/src/lib/connectorCrypto.ts). El frontend generado por la IA
// NUNCA ve estos secretos: las acciones se ejecutan server-side vía el
// gateway de conectores (api-server/src/lib/connectorActions.ts).
export interface IConnectorCredential extends Document {
  userId: string;         // _id del usuario propietario
  connectorId: string;    // id del conector ("slack", "notion", "airtable"…)
  label?: string;         // etiqueta opcional ("Slack del equipo de ventas")
  // Blob cifrado del JSON de credenciales + parámetros AES-256-GCM.
  ciphertext: string;     // base64
  iv: string;             // base64 (12 bytes)
  authTag: string;        // base64 (16 bytes)
  verified: boolean;      // pasó la verificación real de /api/mcp/test al guardarse
  verifiedAt?: Date;
  lastUsedAt?: Date;      // última ejecución de una acción con estas credenciales
  createdAt?: Date;
  updatedAt?: Date;
}

const ConnectorCredentialSchema = new Schema<IConnectorCredential>(
  {
    userId: { type: String, required: true, index: true },
    connectorId: { type: String, required: true },
    label: { type: String },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  { timestamps: true, collection: "connector_credentials" },
);
// Un usuario tiene como mucho UNA credencial por conector (upsert al guardar).
ConnectorCredentialSchema.index({ userId: 1, connectorId: 1 }, { unique: true });

export const ConnectorCredential: Model<IConnectorCredential> =
  mongoose.models.ConnectorCredential ||
  mongoose.model<IConnectorCredential>("ConnectorCredential", ConnectorCredentialSchema);

// ─── Site Settings (ajustes globales del sitio) ──────────────────────────────
// Clave/valor genérico para ajustes que el admin cambia en caliente sin
// redesplegar: modo construcción, banners, feature flags… La clave
// "maintenance_mode" ("on"/"off") controla la página "En construcción"
// que ven los visitantes (los admins pasan siempre).
export interface ISiteSetting extends Document {
  key: string;
  value: string;
  updatedBy?: string; // userId del admin que lo cambió
  createdAt?: Date;
  updatedAt?: Date;
}

const SiteSettingSchema = new Schema<ISiteSetting>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: String, required: true },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: "site_settings" },
);

export const SiteSetting: Model<ISiteSetting> =
  mongoose.models.SiteSetting ||
  mongoose.model<ISiteSetting>("SiteSetting", SiteSettingSchema);

// ─── Ad Campaign Proposal (agente de marketing "Niko") ─────────────────────
// Cada vez que el agente redacta/recomienda una campaña de Google Ads (o una
// edición de una existente), se guarda aquí como PROPUESTA -- nunca toca la
// cuenta real de Google Ads hasta que un humano la aprueba explícitamente
// (status: "approved") y se lanza. El agente puede hacer todo el trabajo
// intelectual solo; el gasto de dinero real requiere confirmación humana,
// al menos mientras se genera confianza con el agente (fácil de quitar
// después: basta con no exigir el paso "approved" antes de lanzar).
export interface IAdCampaignProposal extends Document {
  createdByUserId: string;
  status: "draft" | "approved" | "launched" | "rejected" | "failed";
  action: "create" | "edit" | "pause" | "resume";
  targetCampaignId?: string; // id de Google Ads si es una edición de una campaña existente
  title: string;
  summary: string;           // resumen en lenguaje natural de lo que propone, para mostrar al humano
  proposedConfig: {
    campaignName?: string;
    dailyBudgetEUR?: number;
    biddingStrategy?: string;
    targeting?: {
      locations?: string[];
      languages?: string[];
      devices?: string[];
      demographics?: string;
    };
    adGroups?: {
      name: string;
      keywords: string[];
      headlines: string[];
      descriptions: string[];
    }[];
  };
  estimatedClicksRange?: string;   // ej. "150-300 clics/semana"
  estimatedImpressionsRange?: string;
  reasoning: string;         // por qué el agente recomienda esta configuración
  reviewedByUserId?: string;
  reviewedAt?: Date;
  rejectionReason?: string;
  googleAdsResult?: {        // se rellena SOLO tras lanzar de verdad contra la API real
    campaignId?: string;
    launchedAt?: Date;
    error?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AdCampaignProposalSchema = new Schema<IAdCampaignProposal>(
  {
    createdByUserId: { type: String, required: true, index: true },
    status: { type: String, required: true, default: "draft", index: true },
    action: { type: String, required: true, default: "create" },
    targetCampaignId: { type: String },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    proposedConfig: { type: Schema.Types.Mixed, default: {} },
    estimatedClicksRange: { type: String },
    estimatedImpressionsRange: { type: String },
    reasoning: { type: String, required: true },
    reviewedByUserId: { type: String },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    googleAdsResult: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const AdCampaignProposal: Model<IAdCampaignProposal> =
  mongoose.models.AdCampaignProposal ||
  mongoose.model<IAdCampaignProposal>("AdCampaignProposal", AdCampaignProposalSchema);

// ─── Project Seeds ───────────────────────────────────────────────────────────
export * from "./projectSeeds";

// Drizzle ORM schemas removed — using MongoDB/Mongoose exclusively
