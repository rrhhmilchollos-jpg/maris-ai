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
  hasEverPaid?: boolean;       // true en cuanto Stripe confirma el primer pago
  firstPaidAt?: Date;          // fecha del primer pago confirmado
  registrationIp?: string;
  lastLoginIp?: string;
  lastLoginAt?: Date;
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
  stripeSubscriptionId?: string;
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
    credits: { type: Number, default: 10, required: true },
    stripeCustomerId: { type: String },
    isPremium: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    freeCreditsUsed: { type: Boolean, default: false },
    hasEverPaid: { type: Boolean, default: false },
    firstPaidAt: { type: Date },
    registrationIp: { type: String },
    lastLoginIp: { type: String },
    lastLoginAt: { type: Date },
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
    stripeSubscriptionId: { type: String },
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
  autoPublish?: boolean;
  evaluatorSummary?: string;
  agentNotes?: string;
  plannedPages?: Array<{ name: string; route?: string; purpose?: string }>;
  hasWatermark?: boolean;
  watermarkRemovalPrice?: number;
  watermarkRemovalStripeSessionId?: string;
  watermarkRemovalVivaOrderCode?: number;
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
  requiredEnvVars?: Array<{ name: string; why: string; value?: string }>;
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
    autoPublish: { type: Boolean, default: false },
    evaluatorSummary: { type: String },
    agentNotes: { type: String },
    plannedPages: [{ name: String, route: String, purpose: String }],
    hasWatermark: { type: Boolean, default: true },
    watermarkRemovalPrice: { type: Number, default: 9.99 },
    watermarkRemovalStripeSessionId: { type: String },
    watermarkRemovalVivaOrderCode: { type: Number },
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
    requiredEnvVars: [
      {
        name: { type: String, required: true },
        why: { type: String },
        value: { type: String },
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
  amount: number;
  description: string;
  stripeSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CreditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: { type: String, required: true, index: true },
    kind: { type: String, required: true },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    stripeSessionId: { type: String },
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
  currentAgent?: string;
  awaitingApproval?: boolean;
  approvedFacets?: string[];
  checkpointData?: any;
  editAppId?: string;
  // Job lanzado automáticamente porque la vista previa no renderizó nada
  // (detectado vía postMessage desde el iframe). No cuesta créditos, y al
  // terminar (éxito o fallo) se publica un AppMessage avisando al usuario.
  isAutoRepair?: boolean;
  coderModel: string;
  language: string;
  kind: string;
  attachmentIds: number[];
  isAdmin: boolean;
  hasEverPaid?: boolean;
  retryCount: number;
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
    currentAgent: { type: String },
    awaitingApproval: { type: Boolean, default: false },
    approvedFacets: { type: [String], default: [] },
    checkpointData: { type: Schema.Types.Mixed },
    editAppId: { type: String },
    isAutoRepair: { type: Boolean, default: false },
    coderModel: { type: String, default: "auto" },
    language: { type: String, default: "typescript" },
    kind: { type: String, default: "fullstack" },
    attachmentIds: { type: [Number], default: [] },
    isAdmin: { type: Boolean, default: false },
    hasEverPaid: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },
    workerId: { type: String },
    partialFrontendCode: { type: String },
  },
  { timestamps: true },
);

export const GenerationJob: Model<IGenerationJob> =
  mongoose.models.GenerationJob ||
  mongoose.model<IGenerationJob>("GenerationJob", GenerationJobSchema);

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
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

const AgentMemorySchema = new Schema<IAgentMemory>(
  {
    errorMessage: { type: String, required: true },
    errorContext: { type: String },
    patch: { type: String, required: true },
    language: { type: String, default: "typescript" },
    embedding: { type: [Number] },
  },
  { timestamps: true },
);

export const AgentMemory: Model<IAgentMemory> =
  mongoose.models.AgentMemory ||
  mongoose.model<IAgentMemory>("AgentMemory", AgentMemorySchema);

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
  },
  { timestamps: true },
);

export const AppRuntimeError: Model<IAppRuntimeError> =
  mongoose.models.AppRuntimeError ||
  mongoose.model<IAppRuntimeError>("AppRuntimeError", AppRuntimeErrorSchema);

// ─── Agent Notes (user preferences + app notes) ───────────────────────────────
export interface IAgentNote extends Document {
  userId: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentNoteSchema = new Schema<IAgentNote>(
  {
    userId: { type: String, required: true, unique: true },
    notes: { type: String, default: "" },
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
  responses: Array<{
    senderId: string;
    message: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema = new Schema<ITicket>(
  {
    userId: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_progress', 'closed'], default: 'open' },
    responses: [
      {
        senderId: { type: String, required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export const Ticket: Model<ITicket> =
  mongoose.models.Ticket || mongoose.model<ITicket>('Ticket', TicketSchema);

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

// ─── Project Seeds ───────────────────────────────────────────────────────────
export * from "./projectSeeds";

// Drizzle ORM schemas removed — using MongoDB/Mongoose exclusively
