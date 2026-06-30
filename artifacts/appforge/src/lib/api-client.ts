import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from "@tanstack/react-query";

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken?: () => Promise<string | null>;
      };
    };
  }
}

async function buildAuthHeaders(options?: RequestInit): Promise<Headers> {
  const headers = new Headers(options?.headers || {});
  const hasAuthorization = headers.has("Authorization");
  const token = await window.Clerk?.session?.getToken?.();

  if (token && !hasAuthorization) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // ENCONTRADO en producción (confirmado con un servidor Express real y
  // fetch reales, reproduciendo el bug paso a paso): la mayoría de las
  // llamadas POST/PUT/PATCH de Maris AI pasaban `body: JSON.stringify(...)`
  // SIN especificar el header Content-Type. fetch() sin Content-Type
  // explícito y con un body de tipo string usa "text/plain;charset=UTF-8"
  // por defecto — y express.json() (el body-parser del backend) SOLO
  // parsea el body cuando el Content-Type es application/json. Resultado
  // real observado: req.body llegaba como {} vacío en el backend, así que
  // cualquier `const { autoFix = false } = req.body || {}` caía SIEMPRE al
  // valor por defecto, sin importar lo que el frontend creía estar
  // enviando — esto es lo que impedía que el Autofix IA del Testing Visual
  // arrancara nunca, tanto en el auto-arranque como pulsando el botón
  // manualmente, y probablemente afectaba en silencio a otras 13 llamadas
  // del frontend con el mismo patrón (creación de workflows, toggle de
  // showcase, etc.) — confirmado por código, no solo sospecha, con un
  // grep estructural sobre todo el árbol de componentes/páginas.
  // FIX CENTRALIZADO: si hay un body Y el caller no fijó ya su propio
  // Content-Type (ej. multipart/form-data con boundary automático para
  // FormData, que NUNCA debe forzarse aquí), añadimos
  // "application/json" automáticamente. Arreglar esto en un solo sitio
  // (en vez de en cada una de las 14+ llamadas individuales) garantiza que
  // ninguna llamada futura pueda volver a caer en el mismo bug por
  // descuido.
  const hasContentType = headers.has("Content-Type");
  const bodyIsFormData = typeof FormData !== "undefined" && options?.body instanceof FormData;
  if (options?.body && !hasContentType && !bodyIsFormData) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

// ApiError preserva todos los campos del cuerpo JSON del error (needsConnect, connectUrl, etc.)
export class ApiError extends Error {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, status: number, data: Record<string, any>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await buildAuthHeaders(options);
  // En producción (Vercel) usamos el proxy /api/* → Railway, por lo que baseUrl es vacío.
  // En desarrollo local se puede definir VITE_API_URL para apuntar al servidor local.
  const baseUrl = import.meta.env.VITE_API_URL || "";
  const fullPath = path.startsWith("http") ? path : `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(fullPath, { credentials: "include", ...options, headers });
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errData: Record<string, any> = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const errMsg = (errData.error as string) || (errData.message as string) || `HTTP ${res.status}`;
    throw new ApiError(errMsg, res.status, errData);
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    return text as T;
  }

  return res.json();
}

// ── Query keys ──────────────────────────────────────────────────────────────
export const getGetMeQueryKey = () => ["me"];
export const getGetMyStatsQueryKey = () => ["my-stats"];
export const getListAppsQueryKey = () => ["apps"];
export const getGetAppQueryKey = (id: string) => ["app", id];
export const getListAppMessagesQueryKey = (id: string) => ["app-messages", id];
export const getGetGenerationJobQueryKey = (id: string) => ["generation-job", id];
export const getGetActiveAppJobQueryKey = (id: string) => ["app-active-job", id];
export const getGetMyPreferencesQueryKey = () => ["my-preferences"];
export const getListTemplatesQueryKey = () => ["templates"];
export const getListAdminUsersQueryKey = () => ["admin-users"];
export const getListAdminJobsQueryKey = () => ["admin-jobs"];
export const getGetAdminOverviewQueryKey = () => ["admin-overview"];
export const getListAdminAppsQueryKey = () => ["admin-apps"];
export const getListCreditPackagesQueryKey = () => ["credit-packages"];
export const getListModelsQueryKey = () => ["models"];
export const getListTransactionsQueryKey = () => ["transactions"];
export const getGetAppNotesQueryKey = (id: string) => ["app-notes", id];
export const getListAppRevisionsQueryKey = (id: string) => ["app-revisions", id];
export const getGetAppCustomDomainQueryKey = (id: string) => ["app-custom-domain", id];
export const getListAppRuntimeErrorsQueryKey = (id: string) => ["app-runtime-errors", id];

// ── Types ────────────────────────────────────────────────────────────────────
export interface VisualTestReport {
  fixesApplied: number;
  screenshots: Array<{ viewport: string; width: number; height: number; imageBase64: string }>;
  analysis: { overallScore: number; summary: string; issues: Array<{ severity: string; description: string; suggestion?: string }> };
}
export interface AppRuntimeError {
  id: string; kind: string; message: string; source?: string; lineno?: number; colno?: number; pathname?: string; stack?: string; createdAt: string;
}

// ── Hooks ────────────────────────────────────────────────────────────────────
export function useGetMe(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetMeQueryKey(), queryFn: () => apiFetch("/api/me"), refetchInterval: 30_000, staleTime: 15_000, ...(opts?.query as any) });
}
export function useGetMyStats(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetMyStatsQueryKey(), queryFn: () => apiFetch("/api/me/stats"), ...(opts?.query as any) });
}
export function useGetMyPreferences(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetMyPreferencesQueryKey(), queryFn: () => apiFetch("/api/me/preferences"), ...(opts?.query as any) });
}
export function useUpdateMyPreferences(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ data }: any) => apiFetch("/api/me/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useListApps(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAppsQueryKey(), queryFn: () => apiFetch("/api/apps"), ...(opts?.query as any) });
}
export function useGetApp(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetAppQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}`), ...(opts?.query as any) });
}
export function useDeleteApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export function useGenerateApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ data }: { data: { prompt: string; model: string; language: string; attachments: any[]; kind: string } }) => apiFetch("/api/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useListAppMessages(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAppMessagesQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/messages`), ...(opts?.query as any) });
}
export function useSendAppMessage(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/apps/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useGetGenerationJob(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetGenerationJobQueryKey(id), queryFn: () => apiFetch(`/api/jobs/${id}`), enabled: !!id, ...(opts?.query as any) });
}
export function useGetActiveAppJob(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetActiveAppJobQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/active-job`), enabled: !!id, ...(opts?.query as any) });
}
export function useApproveFacet(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/jobs/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useListTemplates(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListTemplatesQueryKey(), queryFn: () => apiFetch("/api/templates"), ...(opts?.query as any) });
}
export function useCreateCheckoutSession(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ packageId }: { packageId: string }) => apiFetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId }) }), ...(opts?.mutation as any) });
}
export function useListCreditPackages(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListCreditPackagesQueryKey(), queryFn: () => apiFetch("/api/billing/packages"), ...(opts?.query as any) });
}

export function useListModels(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListModelsQueryKey(), queryFn: () => apiFetch("/api/models"), ...(opts?.query as any) });
}
export function useListTransactions(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListTransactionsQueryKey(), queryFn: () => apiFetch("/api/billing/transactions"), ...(opts?.query as any) });
}
export function useGetAdminOverview(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetAdminOverviewQueryKey(), queryFn: () => apiFetch("/api/admin/overview"), ...(opts?.query as any) });
}
export function useListAdminUsers(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAdminUsersQueryKey(), queryFn: () => apiFetch("/api/admin/users"), ...(opts?.query as any) });
}
// A petición explícita del usuario: estado "Activo" dinámico en vivo, no
// solo "cuenta no baneada". Consulta GET /admin/presence (ya existente,
// usa el sistema real de Socket.IO con autenticación Clerk real) con
// refresco frecuente para reflejar quién tiene Maris AI abierto AHORA MISMO.
export function useAdminPresence(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: ["admin", "presence"], queryFn: () => apiFetch("/api/admin/presence"), ...(opts?.query as any) });
}
export function useListAdminApps(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAdminAppsQueryKey(), queryFn: () => apiFetch("/api/admin/apps"), ...(opts?.query as any) });
}
export function useListAdminJobs(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAdminJobsQueryKey(), queryFn: () => apiFetch("/api/admin/jobs"), ...(opts?.query as any) });
}
export function useAdjustUserCredits(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/credits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminRefundCredits(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminSuspendUser(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) }), ...(opts?.mutation as any) });
}
export function useAdminUnsuspendUser(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/admin/users/${id}/unsuspend`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useAdminBanUser(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/ban`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) }), ...(opts?.mutation as any) });
}
export function useAdminUnbanUser(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/admin/users/${id}/unban`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useAdminBlockIp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/block-ip`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminUnblockIp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, ip }: any) => apiFetch(`/api/admin/users/${id}/block-ip/${encodeURIComponent(ip)}`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export const getAdminUserTransactionsQueryKey = (id: string) => ["admin-user-transactions", id];
export function useAdminUserTransactions(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getAdminUserTransactionsQueryKey(id), queryFn: () => apiFetch(`/api/admin/users/${id}/transactions`), enabled: !!id, ...(opts?.query as any) });
}
export const getAdminUserAppsQueryKey = (id: string) => ["admin-user-apps", id];
export function useAdminUserApps(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getAdminUserAppsQueryKey(id), queryFn: () => apiFetch(`/api/admin/users/${id}/apps`), enabled: !!id, ...(opts?.query as any) });
}
export function useRetryAdminJob(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/admin/jobs/${id}/retry`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useAdminStripeRefund(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/stripe-refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminAddNote(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminSendCompensationEmail(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/send-compensation-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export const getAdminMyProjectsQueryKey = () => ["admin-my-projects"];
export function useAdminMyProjects(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getAdminMyProjectsQueryKey(), queryFn: () => apiFetch("/api/admin/my-projects"), ...(opts?.query as any) });
}
export function useAdminCreateMyProject(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ data }: any) => apiFetch("/api/admin/my-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useAdminDeleteMyProject(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/admin/my-projects/${id}`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export function useUpdateAppModel(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/apps/${id}/model`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useUpdateAppAutoPublish(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/apps/${id}/auto-publish`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useRetryAppGeneration(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/retry`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useHealthCheckApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/health`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useDeployApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/deploy`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useGetDeployStatus(appId: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: ["apps", appId, "deploy-status"], queryFn: () => apiFetch(`/api/apps/${appId}/deploy-status`), enabled: !!appId, ...(opts?.query as any) });
}
export function useDeepTestApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/deep-test`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useGetAppDomain(appId: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: ["apps", appId, "domain"], queryFn: () => apiFetch(`/api/apps/${appId}/domain`), enabled: !!appId, ...(opts?.query as any) });
}
export function useConnectAppDomain(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, domain }: any) => apiFetch(`/api/apps/${id}/domain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) }), ...(opts?.mutation as any) });
}
export function useDisconnectAppDomain(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/domain`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export function useDeployAppToVercel(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/deploy/vercel`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function usePushAppToGitHub(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/github`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useGenerateAppImages(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/images`, { method: "POST" }), ...(opts?.mutation as any) });
}
// NOTA: sin consumidores actualmente (verificado por grep en todo el árbol
// de componentes/páginas). El endpoint POST /visual-test ahora es
// ASÍNCRONO (ver routes/deployment.ts) — esta mutation solo crea el job y
// devuelve {jobId, status:"running"}, NO el resultado final. Si se
// reactiva este hook en el futuro, hace falta hacer polling contra
// GET /api/apps/:id/visual-test/:jobId hasta status:"succeeded"|"failed"
// — ver visual-test-panel.tsx → submitVisualTestJob() para el patrón ya
// implementado y probado.
export function useVisualTestApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/visual-test`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useForkApp(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/fork`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useListAppRuntimeErrors(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAppRuntimeErrorsQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/runtime-errors`), ...(opts?.query as any) });
}
export function useClearAppRuntimeErrors(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/runtime-errors`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export function useGetAppNotes(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetAppNotesQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/notes`), ...(opts?.query as any) });
}
export function useUpdateAppNotes(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/apps/${id}/notes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useListAppRevisions(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAppRevisionsQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/revisions`), ...(opts?.query as any) });
}
export function useRestoreAppRevision(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, revisionId }: any) => apiFetch(`/api/apps/${id}/revisions/${revisionId}/restore`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useGetAppCustomDomain(id: string, opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetAppCustomDomainQueryKey(id), queryFn: () => apiFetch(`/api/apps/${id}/custom-domain`), ...(opts?.query as any) });
}
export function useAttachAppCustomDomain(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/apps/${id}/custom-domain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useDetachAppCustomDomain(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/custom-domain`, { method: "DELETE" }), ...(opts?.mutation as any) });
}
export function useConfirmCheckout(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ data }: any) => apiFetch("/api/billing/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}

export const getGetGenerationJobLogsQueryKey = (id: string) => ["generation-job-logs", id];
export async function getGenerationJobLogs(id: string, params: { afterId?: string | number }, options?: RequestInit): Promise<{ logs: JobLogEntry[] }> {
  const searchParams = new URLSearchParams();
  if (params.afterId) searchParams.set("afterId", params.afterId.toString());
  return apiFetch(`/api/jobs/${id}/logs?${searchParams.toString()}`, options);
}

export interface JobLogEntry {
  id: string;
  jobId: string;
  agent: string;
  level: string;
  message: string;
  createdAt: string;
}

// ✅ Seguimiento 2: Historial de créditos para el gráfico de uso
export const getGetCreditsHistoryQueryKey = () => ["credits-history"];
export function useGetCreditsHistory(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetCreditsHistoryQueryKey(), queryFn: () => apiFetch("/api/me/credits-history"), refetchInterval: 60_000, ...(opts?.query as any) });
}

// ✅ Seguimiento 3: Notificaciones en tiempo real
export const getGetNotificationsQueryKey = () => ["notifications"];
export function useGetNotifications(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getGetNotificationsQueryKey(), queryFn: () => apiFetch("/api/me/notifications"), refetchInterval: 30_000, ...(opts?.query as any) });
}
