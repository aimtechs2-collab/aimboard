import {
  httpRequestDurationSeconds,
  httpRequestFailuresTotal,
  httpRequestsTotal,
  normalizeExpressRoute,
  shouldSkipHttpMetrics,
} from "../utils/prometheus.mjs";

/**
 * Prometheus HTTP metrics: duration histogram + request counters.
 * Skips /metrics. Uses method + normalized route + status_code (low cardinality).
 */
export function createHttpMetricsMiddleware() {
  return function httpMetricsMiddleware(req, res, next) {
    if (shouldSkipHttpMetrics(req.path)) {
      next();
      return;
    }
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const route = normalizeExpressRoute(req);
      const method = req.method || "UNKNOWN";
      const status = String(res.statusCode ?? 0);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDurationSeconds.labels(method, route, status).observe(seconds);
      httpRequestsTotal.labels(method, route, status).inc();
      if (res.statusCode >= 500) {
        httpRequestFailuresTotal.labels(method, route, status).inc();
      }
    });
    next();
  };
}
