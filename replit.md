# AppForge

## Overview

AppForge is a full-stack SaaS platform designed to transform natural language prompts into functional web applications. Leveraging advanced AI models, it offers users the ability to generate ready-to-run web apps, significantly accelerating the development process. The platform supports a credit-based system for app generation, with options for free trials and paid credit packages. Its core vision is to democratize web development by making it accessible through intuitive AI-powered tools, targeting both individual developers and small businesses seeking rapid prototyping and deployment solutions.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

The AppForge system is composed of a React-based frontend, a Node.js/Express backend, and shared libraries.

**Frontend (`artifacts/appforge`)**:
- Built with React, Vite, and TailwindCSS.
- Utilizes `shadcn/ui` for UI components and `wouter` for routing.
- Implements Clerk for user authentication and Framer Motion for animations.
- Features a dark theme with violet and cyan accents.
- The workspace includes a split panel for chat interaction and a live preview powered by `@codesandbox/sandpack-react`, which dynamically parses and displays generated frontend code. `wouter` is shipped as a real Sandpack dependency pinned to `^2.12.1` (CommonJS) — wouter v3 is pure ESM and Sandpack v2's bundler hangs on it indefinitely.
- Generated applications include placeholder images, which can be replaced with AI-generated images via the Nano Banana Pro feature.

**Backend (`artifacts/api-server`)**:
- Developed with Node.js, Express, and TypeScript.
- Uses Drizzle ORM for PostgreSQL database interactions.
- Integrates Clerk Express middleware for authentication and user management.
- Incorporates Anthropic and Stripe SDKs for AI generation and billing.
- Designed with an OpenAPI 3.1 specification as the single source of truth for API contracts.
- Features an admin interface for managing users, credits, and generated applications.

**Shared Libraries (`lib/`)**:
- `lib/db`: Drizzle schema and PostgreSQL connection pool.
- `lib/api-spec`: OpenAPI 3.1 specification.
- `lib/api-zod`, `lib/api-client-react`: Generated clients for API interaction.
- `lib/integrations-anthropic-ai`, `lib/integrations-gemini-ai`: Singletons for AI model access via Replit's AI proxy.

**Multi-Agent AI Pipeline**:
- The core of the application generation is an asynchronous, multi-agent AI pipeline orchestrated by `lib/generate.ts`.
- Different AI models (Anthropic Claude Sonnet/Haiku, Google Gemini Flash, GPT-5 Codex) are assigned specific roles based on their strengths (e.g., Researcher, Architect, Coder, QA Reviewer, Patcher).
- The pipeline includes an autonomous self-healing loop with a validator (`esbuild`) and a patcher to automatically correct build errors and improve code quality.
- Generation is asynchronous, providing real-time progress updates to the user.
- Supports iterative editing with a dedicated edit mode that utilizes a single AI pass.
- Generated applications are locked to either TypeScript or JavaScript.

**Database Schema**:
- `users`: Stores user information, Clerk ID, email, and credit balance.
- `generated_apps`: Stores details of generated applications, including code, prompt, and status.
- `credit_transactions`: Logs credit usage and purchases.
- `app_messages`: Stores chat history for iterative app refinement.

**Authentication**:
- Fully delegated to Clerk, with backend middleware provisioning user profiles and initial credits on the first authenticated request.
- Admin access is controlled via an `ADMIN_EMAILS` environment variable, granting unlimited credits and access to administrative routes.

**Deployment and Actions**:
- Each app provides actions like model selection for edits, ZIP export, health checks, public deployment with a unique slug, and GitHub repository creation.
- Public deployments (`/p/:slug`) are isolated within an iframe with strict security policies to prevent cross-origin attacks.

## External Dependencies

- **Clerk**: User authentication and management.
- **Anthropic Claude**: AI models for reasoning, planning, and code generation (`claude-sonnet-4-6`, `claude-haiku-4-5`).
- **Google Gemini**: AI models for bulk code generation and image generation (`gemini-2.5-flash`, `gemini-3-pro-image-preview`).
- **GPT-5 Codex**: Premium AI model for advanced code generation.
- **Stripe**: Payment processing for credit packages (optional, configurable via environment variables).
- **PostgreSQL**: Primary database for storing application data.
- **@codesandbox/sandpack-react**: Frontend live preview in the workspace.
- **Replit AI Integrations Proxy**: Access to Anthropic, Gemini, and OpenAI models without direct API key management.
- **Replit GitHub Connector (@replit/connectors-sdk)**: Integration for pushing generated code to GitHub repositories.
- **esbuild**: In-memory bundle validation and processing.
- **archiver**: For streaming ZIP file exports.
- **OpenAPI 3.1**: API specification.