import {
  Counter,
  Histogram,
  collectDefaultMetrics,
  register,
} from "prom-client";

let defaultMetricsStarted = false;

/** Call once at process startup (after env is loaded). */
export function initPrometheusDefaultMetrics() {
  if (defaultMetricsStarted) {
    return;
  }
  defaultMetricsStarted = true;
  collectDefaultMetrics({
    register,
    labels: { service: "aimboard-ai-backend" },
  });
}

export { register };

const httpBuckets = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
];

/** HTTP request duration (all routes except /metrics). */
export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: httpBuckets,
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP responses",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

/** Responses with HTTP status >= 500. */
export const httpRequestFailuresTotal = new Counter({
  name: "http_request_failures_total",
  help: "HTTP 5xx responses",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

/** End-to-end AI handler work (streaming or not), excluding auth/db bootstrap before try. */
export const aiGenerationDurationSeconds = new Histogram({
  name: "ai_generation_duration_seconds",
  help: "AI generation handler duration in seconds",
  labelNames: ["operation", "provider", "result"],
  buckets: httpBuckets,
  registers: [register],
});

export const aiGenerationFailuresTotal = new Counter({
  name: "ai_generation_failures_total",
  help: "AI generation failures (handler catch / stream error)",
  labelNames: ["operation", "provider"],
  registers: [register],
});

/** Wall time spent inside OpenAI chat.completions API calls only. */
export const openaiRequestDurationSeconds = new Histogram({
  name: "openai_request_duration_seconds",
  help: "OpenAI chat.completions round-trip duration in seconds",
  labelNames: ["operation"],
  buckets: httpBuckets,
  registers: [register],
});

export const openaiTokensTotal = new Counter({
  name: "openai_tokens_total",
  help: "OpenAI token usage (from API usage fields)",
  labelNames: ["token_type", "endpoint"],
  registers: [register],
});

export const boardSaveDurationSeconds = new Histogram({
  name: "board_save_duration_seconds",
  help: "Board PUT save path duration (gzip + UPDATE) in seconds",
  labelNames: ["result"],
  buckets: httpBuckets,
  registers: [register],
});

export const workspacesCreatedTotal = new Counter({
  name: "workspaces_created_total",
  help: "New workspaces created (first-time ensureDefaultWorkspace insert)",
  registers: [register],
});

export const prismaQueryDurationSeconds = new Histogram({
  name: "prisma_query_duration_seconds",
  help: "Prisma client operation duration in seconds",
  labelNames: ["model", "action", "result"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const ENDPOINT_TOKEN_LABEL = {
  "/v1/ai/text-to-diagram/chat-streaming": "text_to_diagram_stream",
  "/v1/ai/sidebar-chat-streaming": "sidebar_stream",
  "/v1/ai/sidebar-chat": "sidebar",
  "/v1/ai/diagram-to-code/generate": "diagram_to_code",
  "/v1/ai/ollama/models": "ollama_models",
};

export function recordOpenAiTokens(endpointPath, promptTokens, completionTokens, model) {
  const m = String(model ?? "");
  if (m.startsWith("ollama:")) {
    return;
  }
  const ep = ENDPOINT_TOKEN_LABEL[endpointPath] || "other";
  const p = Number(promptTokens);
  const c = Number(completionTokens);
  if (Number.isFinite(p) && p > 0) {
    openaiTokensTotal.labels("prompt", ep).inc(p);
  }
  if (Number.isFinite(c) && c > 0) {
    openaiTokensTotal.labels("completion", ep).inc(c);
  }
}

export function observeOpenAiSeconds(operation, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return;
  }
  openaiRequestDurationSeconds.labels(operation).observe(seconds);
}

export function observeAiGenerationSeconds(operation, provider, seconds, success) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return;
  }
  const result = success ? "success" : "error";
  const prov = provider === "ollama" ? "ollama" : "openai";
  aiGenerationDurationSeconds.labels(operation, prov, result).observe(seconds);
}

export function recordAiGenerationFailure(operation, provider) {
  const prov = provider === "ollama" ? "ollama" : "openai";
  aiGenerationFailuresTotal.labels(operation, prov).inc();
}

export function observeBoardSaveSeconds(seconds, result) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return;
  }
  boardSaveDurationSeconds.labels(result).observe(seconds);
}

export function recordWorkspaceCreated() {
  workspacesCreatedTotal.inc();
}

export function observePrismaQuerySeconds(model, action, seconds, isError) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return;
  }
  const result = isError ? "error" : "success";
  prismaQueryDurationSeconds.labels(model, action, result).observe(seconds);
}

/**
 * Low-cardinality route for HTTP metrics: prefer Express route template, else normalize path.
 */
export function normalizeExpressRoute(req) {
  try {
    if (req.route && typeof req.route.path === "string") {
      const base = req.baseUrl || "";
      const full = `${base}${req.route.path}` || req.route.path;
      return full.startsWith("/") ? full : `/${full}`;
    }
  } catch {
    // fall through
  }
  return normalizePathTemplate(String(req.path || req.url || "").split("?")[0] || "/");
}

export function normalizePathTemplate(path) {
  if (!path || path === "") {
    return "/";
  }
  const parts = path.split("/").map((seg) => {
    if (!seg) {
      return seg;
    }
    if (/^\d+$/.test(seg)) {
      return ":id";
    }
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(seg)) {
      return ":uuid";
    }
    return seg;
  });
  const out = parts.join("/");
  return out.startsWith("/") ? out : `/${out}`;
}

export function shouldSkipHttpMetrics(path) {
  return path === "/metrics";
}
