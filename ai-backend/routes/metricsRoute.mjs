import { register } from "../utils/prometheus.mjs";

/**
 * GET /metrics — Prometheus scrape endpoint.
 * - Production: METRICS_SCRAPE_TOKEN is required; requests must send
 *   Authorization: Bearer <token> or ?token= (same value).
 * - Non-production: if the env var is unset, /metrics is open (local dev).
 */
export function registerMetricsRoute(app, { logger }) {
  app.get("/metrics", async (req, res) => {
    const isProduction = process.env.NODE_ENV === "production";
    const secret = process.env.METRICS_SCRAPE_TOKEN?.trim();

    if (isProduction && !secret) {
      res
        .status(503)
        .send("Metrics unavailable: set METRICS_SCRAPE_TOKEN for production");
      return;
    }

    if (secret) {
      const bearer =
        typeof req.headers.authorization === "string" &&
        req.headers.authorization.startsWith("Bearer ")
          ? req.headers.authorization.slice(7).trim()
          : null;
      const q =
        typeof req.query.token === "string" ? req.query.token.trim() : null;
      const ok = bearer === secret || q === secret;
      if (!ok) {
        res
          .status(401)
          .set("WWW-Authenticate", 'Bearer realm="metrics"')
          .send("Unauthorized");
        return;
      }
    }

    try {
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      logger?.error?.({ err }, "[metrics] failed to render metrics");
      res.status(500).send("metrics unavailable");
    }
  });
}
