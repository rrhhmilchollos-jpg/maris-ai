import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Users ───────────────────────────────────────────────────────────────────
export interface IUser extends Document {
  _id: string;
  email: string;
  fullName?: string;
  imageUrl?: string;
  credits: number;
  stripeCustomerId?: string;
  isPremium?: boolean;
  isAdmin?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    fullName: { type: String },
    imageUrl: { type: String },
    credits: { type: Number, default: 3, required: true },
    stripeCustomerId: { type: String },
    isPremium: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", UserSchema);

// ─── Generated Apps ──────────────────────────────────────────────────────────
export interface IGeneratedApp extends Document {
  _id: string;
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
  },
  { timestamps: true },
);

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
  editAppId?: string;
  coderModel: string;
  language: string;
  kind: string;
  attachmentIds: number[];
  isAdmin: boolean;
  retryCount: number;
  workerId?: string;
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
    editAppId: { type: String },
    coderModel: { type: String, default: "auto" },
    language: { type: String, default: "typescript" },
    kind: { type: String, default: "fullstack" },
    attachmentIds: { type: [Number], default: [] },
    isAdmin: { type: Boolean, default: false },
    retryCount: { type: Number, default: 0 },
    workerId: { type: String },
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
