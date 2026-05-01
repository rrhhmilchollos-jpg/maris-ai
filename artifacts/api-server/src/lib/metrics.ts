import type { Request, Response, NextFunction } from "express";

interface RouteCounter {
  count: number;
  errors: number;
  totalDurationMs: number;
}

// Hard cap so a hostile client can never blow process memory by hammering
// random paths that don't match any defined route (which would land in the
// "unmatched" bucket anyway, but defense in depth).
const MAX_BUCKETS = 200;

const routeCounters = new Map<string, RouteCounter>();
let totalRequests = 0;
let totalErrors = 0;
let droppedHighCardinality = 0;
const startedAt = Date.now();

function bucketKey(req: Request): string {
  // Only group by the route definition (e.g. "/apps/:id/messages"), never
  // the raw req.path — that would let any URL-segment (slugs, UUIDs, public
  // app IDs, image hashes) create a unique counter and grow the Map without
  // bound. If no route matched (404, middleware-only path), bucket all of
  // them under one shared key.
  const route = req.route?.path;
  if (!route) {
    return `${req.method} (unmatched)`;
  }
  // Express prefixes router-mounted routes with the mount path via baseUrl,
  // so include it to disambiguate `/healthz` mounted under different routers.
  const fullPath = `${req.baseUrl ?? ""}${route}`;
  return `${req.method} ${fullPath}`;
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  res.on("finish", () => {
    const key = bucketKey(req);
    let counter = routeCounters.get(key);
    if (!counter) {
      if (routeCounters.size >= MAX_BUCKETS) {
        // Cap reached — drop silently so we never OOM the process.
        droppedHighCardinality += 1;
        totalRequests += 1;
        if (res.statusCode >= 500) totalErrors += 1;
        return;
      }
      counter = { count: 0, errors: 0, totalDurationMs: 0 };
      routeCounters.set(key, counter);
    }
    counter.count += 1;
    counter.totalDurationMs += Date.now() - start;
    if (res.statusCode >= 500) counter.errors += 1;
    totalRequests += 1;
    if (res.statusCode >= 500) totalErrors += 1;
  });
  next();
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  droppedHighCardinality: number;
  routes: Array<{
    route: string;
    count: number;
    errors: number;
    avgDurationMs: number;
  }>;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const routes = Array.from(routeCounters.entries())
    .map(([route, c]) => ({
      route,
      count: c.count,
      errors: c.errors,
      avgDurationMs: c.count === 0 ? 0 : Math.round(c.totalDurationMs / c.count),
    }))
    .sort((a, b) => b.count - a.count);

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    errorRate: totalRequests === 0 ? 0 : totalErrors / totalRequests,
    droppedHighCardinality,
    routes,
  };
}
