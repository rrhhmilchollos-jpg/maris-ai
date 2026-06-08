# Testing Agent Design for Maris AI

## Architecture Overview
The Testing Agent will be implemented as a specialized module on the backend that systematically validates the generated application bundle, identifies issues using an LLM (Claude), and performs automated repairs.

## Key Components

### 1. `tester.ts` (Backend Agent)
- **Location**: `artifacts/api-server/src/lib/tester.ts`
- **Responsibilities**:
    - Systematic validation (Syntax, Imports, Dependencies, Build).
    - Analysis of results using Claude Sonnet.
    - Coordination with `patchBundle` for repairs.
    - Reporting progress and issues via `JobLog`.

### 2. Integration in `apps.ts`
- **Location**: `artifacts/api-server/src/routes/apps.ts`
- **Changes**:
    - Add a new `tests` phase in the pipeline.
    - Inject the `runTestingAgent` call after the frontend generation and before the final validation loop.
    - Ensure it uses the existing `log` and `onProgress` callbacks to communicate with the frontend.

### 3. Frontend Communication
- **Current Transport**: REST Polling (`/api/jobs/:id/logs`).
- **Strategy**:
    - Emit specialized log messages with a new agent type `tester`.
    - The frontend already aliases `testing`, `patcher`, `validator`, and `repair` to `testing-agent`.
    - We will use the `testing` agent name for logs to ensure they appear in the UI under the correct label.

## Validation Steps
1. **Syntax Check**: Using `esbuild` (leveraging existing `validateBundle`).
2. **Import Resolution**: Ensuring all local and package imports are valid.
3. **Dependency Check**: Verifying `package.json` consistency.
4. **Build Simulation**: Ensuring the bundle can be compiled (leveraging `validateBundle`).

## Repair Loop
- Max attempts: 5 (as per user request).
- If a test fails, the error is sent to Claude to generate a fix instruction.
- `patchBundle` is called with the fix instruction to update the code.
- The loop repeats until all tests pass or max attempts are reached.
