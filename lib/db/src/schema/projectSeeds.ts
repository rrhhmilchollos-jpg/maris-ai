import mongoose, { Schema, Document, Model } from "mongoose";

export interface IProjectSeed extends Document {
  title: string;
  description: string;
  keywords: string[];
  techStack: string[];
  frontendCodeSnippet?: string;
  backendCodeSnippet?: string;
  referenceUrls: string[];
  kind: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSeedSchema = new Schema<IProjectSeed>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    keywords: { type: [String], default: [] },
    techStack: { type: [String], default: [] },
    frontendCodeSnippet: { type: String },
    backendCodeSnippet: { type: String },
    referenceUrls: { type: [String], default: [] },
    kind: { type: String, required: true },
  },
  { timestamps: true },
);

export const ProjectSeed: Model<IProjectSeed> =
  mongoose.models.ProjectSeed ||
  mongoose.model<IProjectSeed>("ProjectSeed", ProjectSeedSchema);
