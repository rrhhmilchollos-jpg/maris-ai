# AppForge

## Overview

AppForge is a full-stack SaaS platform that converts natural language prompts into functional web applications using AI. It aims to democratize web development by providing intuitive AI-powered tools for rapid prototyping and deployment, serving individual developers and small businesses. The platform operates on a credit-based system, offering free trials and paid credit packages for app generation.

## User Preferences

- I prefer a dark theme with violet/cyan accents for the UI.
- The UI should incorporate shadcn/ui components and Framer Motion animations for a modern and fluid user experience.
- The system should prioritize Spanish for all user-visible copy in generated applications, while keeping identifiers in English.
- I expect the AI to automatically include a backend when generating apps for marketplace, e-commerce, social, or SaaS platforms.
- I prefer that there are no strict size limits imposed on generated frontend bundles, acknowledging that larger apps may consume more credits.
- I prefer that generated bundles do not silently drop custom CSS files and that the preview accurately reflects all styles.

## System Architecture

AppForge features a React frontend, a Node.js/Express backend, and shared libraries, designed for asynchronous, multi-agent AI-driven application generation.

**Frontend**:
- Built with React, Vite, and TailwindCSS, utilizing `shadcn/ui` and `wouter` for routing.
- Employs Clerk for authentication and Framer Motion for animations.
- Features a dark theme with violet and cyan accents.
- The workspace includes a split panel for chat and a live preview powered by `@codesandbox/sandpack-react` for dynamic code display.
- Supports file attachments (images, PDFs, text, Markdown, CSV, JSON) in chat prompts for AI context.
- Implements a Visual Testing Agent for server-side UI testing and auto-correction across multiple viewports, with a feedback loop for code patching.
- Includes a Post-failure Diagnostic Agent to provide actionable insights for failed generation jobs.
- Provides various project type tabs on the dashboard (e.g., fullstack, mobile-first PWA, landing page, 2D/3D game, hybrid PWA), each influencing AI generation with specific intents and credit costs.
- Displays live, streaming agent logs during generation for real-time progress updates.

**Backend**:
- Developed with Node.js, Express, and TypeScript.
- Uses Drizzle ORM for PostgreSQL and Clerk Express middleware for user management.
- Integrates Anthropic and Stripe SDKs for AI generation and billing.
- Defined by an OpenAPI 3.1 specification for API contracts.
- Features an admin interface and supports user-owned backend code visibility.

**Multi-Agent AI Pipeline**:
- An asynchronous pipeline orchestrated by `lib/generate.ts`, utilizing various AI models (Anthropic Claude, Google Gemini, GPT-5 Codex) for roles like Researcher, Architect, Coder, and QA.
- Includes an autonomous self-healing loop with `esbuild` for validation and patching.
- Supports iterative editing and provides real-time progress updates.

**Database and Authentication**:
- PostgreSQL is used with a schema including `users`, `generated_apps`, `credit_transactions`, `app_messages`, and `job_logs`.
- Authentication is handled by Clerk, with middleware for user provisioning and credit management.
- Admin access is controlled via environment variables.

**Deployment and Actions**:
- Generated apps can be publicly deployed with unique slugs (isolated via iframes), exported as ZIP files, pushed to GitHub, and forked.
- `backendCode` is explicitly included in the edit prompt context for AI to modify backend aspects.

## External Dependencies

- **Clerk**: User authentication and management.
- **Anthropic Claude**: AI models (`claude-sonnet-4-6`, `claude-haiku-4-5`).
- **Google Gemini**: AI models (`gemini-2.5-flash`, `gemini-3-pro-image-preview`).
- **GPT-5 Codex**: Advanced AI model.
- **Stripe**: Payment processing.
- **PostgreSQL**: Primary database.
- **@codesandbox/sandpack-react**: Frontend live preview.
- **Replit AI Integrations Proxy**: Access to AI models.
- **Replit GitHub Connector (@replit/connectors-sdk)**: GitHub repository integration.
- **esbuild**: Bundle validation and processing.
- **archiver**: ZIP file export.
- **OpenAPI 3.1**: API specification.