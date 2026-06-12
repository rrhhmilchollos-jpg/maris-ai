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
  // ID Universal Maris AI — formato USR-<timestamp_base36>-<random6>
  // Identifica al usuario de forma única en todo el ecosistema de Maris AI
  marisId?: string;
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
    // ID Universal Maris AI
    marisId: { type: String, unique: true, sparse: true, index: true },
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
  deploymentStatus?: string;
  deploymentError?: string;
  marisaiSubdomain?: string;
  customDomain?: string;
  customDomainProvider?: string;
  customDomainVerified?: boolean;
  lastDeployedAt?: Date;
  deploymentLogs?: string;
  requiredEnvVars?: Array<{ name: string; why: string; value?: string }>;
  // ID Universal Maris AI — formato PRJ-<timestamp_base36>-<random6>
  // Identifica al proyecto de forma única en todo el ecosistema de Maris AI
  marisId?: string;
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
    deploymentStatus: { type: String, default: "not_deployed", enum: ["not_deployed", "deploying", "deployed", "failed"] },
    deploymentError: { type: String },
    marisaiSubdomain: { type: String, unique: true, sparse: true },
    customDomain: { type: String },
    customDomainProvider: { type: String },
    customDomainVerified: { type: Boolean, default: false },
    lastDeployedAt: { type: Date },
    deploymentLogs: { type: String },
    requiredEnvVars: [
      {
        name: { type: String, required: true },
        why: { type: String },
        value: { type: String },
      },
    ],
    // ID Universal Maris AI
    marisId: { type: String, unique: true, sparse: true, index: true },
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

// ─── Project Seeds ───────────────────────────────────────────────────────────
export * from "./projectSeeds";

// Drizzle ORM schemas removed — using MongoDB/Mongoose exclusively
