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

  return headers;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await buildAuthHeaders(options);
  const res = await fetch(path, { credentials: "include", ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
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
  return useQuery<any>({ queryKey: getGetMeQueryKey(), queryFn: () => apiFetch("/api/me"), ...(opts?.query as any) });
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
  return useMutation<any, any, any>({ mutationFn: ({ priceId }: { priceId: string }) => apiFetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceId }) }), ...(opts?.mutation as any) });
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
export function useListAdminApps(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAdminAppsQueryKey(), queryFn: () => apiFetch("/api/admin/apps"), ...(opts?.query as any) });
}
export function useListAdminJobs(opts?: { query?: Partial<UseQueryOptions> }) {
  return useQuery<any>({ queryKey: getListAdminJobsQueryKey(), queryFn: () => apiFetch("/api/admin/jobs"), ...(opts?.query as any) });
}
export function useAdjustUserCredits(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id, data }: any) => apiFetch(`/api/admin/users/${id}/credits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), ...(opts?.mutation as any) });
}
export function useRetryAdminJob(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/admin/jobs/${id}/retry`, { method: "POST" }), ...(opts?.mutation as any) });
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
export function useDeployAppToVercel(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/deploy/vercel`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function usePushAppToGitHub(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/github`, { method: "POST" }), ...(opts?.mutation as any) });
}
export function useGenerateAppImages(opts?: { mutation?: Partial<UseMutationOptions<any, any, any>> }) {
  return useMutation<any, any, any>({ mutationFn: ({ id }: any) => apiFetch(`/api/apps/${id}/images`, { method: "POST" }), ...(opts?.mutation as any) });
}
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
