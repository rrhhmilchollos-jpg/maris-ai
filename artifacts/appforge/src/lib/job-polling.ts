import { ApiError } from "@/lib/api-client";

type PollingQuery = {
  state?: {
    fetchFailureCount?: number;
    error?: unknown;
  };
};

/**
 * Política única para las consultas que acompañan un trabajo de generación.
 *
 * El panel previo hacía polling independiente de app, job, logs y mensajes a
 * 1–3 segundos (y algunos streams a 400 ms). Varias pestañas superaban el
 * límite global de la API aunque cada consulta individual pareciera razonable.
 * Esta política parte de una frecuencia conservadora y aumenta el intervalo
 * de forma exponencial tras cualquier fallo, especialmente un HTTP 429.
 */
export const JOB_POLLING = {
  app: 8_000,
  activeJob: 6_000,
  job: 6_000,
  logs: 8_000,
  messages: 10_000,
  adminJobs: 10_000,
  adminLogs: 12_000,
  maxBackoff: 60_000,
} as const;

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

export function pollingInterval(
  query: PollingQuery | undefined,
  enabled: boolean,
  baseMs: number,
): number | false {
  if (!enabled) return false;

  const failureCount = query?.state?.fetchFailureCount ?? 0;
  const error = query?.state?.error;
  if (failureCount <= 0 && !isRateLimited(error)) return baseMs;

  // El primer 429 espera 2×; fallos posteriores suben hasta 60 segundos.
  // No reintentamos inmediatamente: el siguiente intervalo es el backoff.
  const exponent = Math.min(Math.max(failureCount, 1), 5);
  const multiplier = isRateLimited(error) ? 2 ** exponent : 2 ** Math.max(exponent - 1, 0);
  return Math.min(JOB_POLLING.maxBackoff, baseMs * multiplier);
}

export function retryPollingRequest(failureCount: number, error: unknown): boolean {
  // Un 429 ya programa backoff mediante refetchInterval; reintentar de forma
  // inmediata multiplica solicitudes y vuelve a activar el mismo limitador.
  if (isRateLimited(error)) return false;
  return failureCount < 1;
}

export function pollingRetryDelay(attempt: number): number {
  return Math.min(15_000, 1_500 * 2 ** Math.min(attempt, 3));
}
