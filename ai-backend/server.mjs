import path from "node:path";
import { fileURLToPath } from "node:url";

import { clerkMiddleware, getAuth } from "@clerk/express";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { buildAppDeps } from "./bootstrap/buildAppDeps.mjs";
import { registerRoutes, routeManifest } from "./bootstrap/registerRoutes.mjs";
import { startServer } from "./bootstrap/startServer.mjs";
import { ensureSchema } from "./db/ensureSchema.mjs";
import { getPrisma, pgQuery as prismaPgQuery } from "./db/prismaClient.mjs";
import { isAllowedChatImageUrl } from "./lib/googleImageSearch.mjs";
import { logger } from "./lib/logger.mjs";
import { createAuditV1Middleware } from "./middleware/auditV1.mjs";
import { createHttpMetricsMiddleware } from "./middleware/metrics.mjs";
import { attachRealtimeServer } from "./realtime/socketServer.mjs";
import { createAiProviderService } from "./services/ai/providerService.mjs";
import {
  defaultEmptyScene,
  gzipBufferToScene,
  sceneToGzipBuffer,
} from "./services/db/boardData.mjs";
import {
  buildSidebarOpenAIMessages,
  parseSidebarChatMode,
  runSidebarImagePipeline,
  SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
  SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
} from "./services/ai/sidebarChat.mjs";
import { createRedisCache } from "./services/cache/redisCache.mjs";
import { createDbHealthMonitor } from "./services/db/healthMonitor.mjs";
import { registerMetricsRoute } from "./routes/metricsRoute.mjs";
import {
  initPrometheusDefaultMetrics,
  recordOpenAiTokens,
} from "./utils/prometheus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".env.development.local") });
dotenv.config({ path: path.join(repoRoot, ".env.development") });
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });
// Allow secrets beside server.mjs (common for API keys, etc.)
dotenv.config({ path: path.join(__dirname, ".env.development.local") });
dotenv.config({ path: path.join(__dirname, ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });
initPrometheusDefaultMetrics();
const prisma = getPrisma();

const isProduction = process.env.NODE_ENV === "production";
/** Nginx / Vercel → VPS: set TRUST_PROXY=1 or BEHIND_REVERSE_PROXY=1 for correct req.ip / URL. */
const trustProxy =
  process.env.TRUST_PROXY === "1" ||
  process.env.BEHIND_REVERSE_PROXY === "1" ||
  process.env.RENDER === "true";

// Render/Heroku/Railway set PORT; local dev often uses AI_BACKEND_PORT (e.g. 3016).
const PORT = parseInt(
  process.env.PORT || process.env.AI_BACKEND_PORT || "3016",
  10,
);
const LISTEN_HOST =
  process.env.AI_BACKEND_HOST ||
  (isProduction ? "0.0.0.0" : "127.0.0.1");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL?.trim() || "http://45.198.59.91:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL_DEFAULT || "llama3.1:8b";
const OLLAMA_TIMEOUT_MS = parseInt(
  process.env.OLLAMA_TIMEOUT_MS || "120000",
  10,
);
const AI_PROVIDER_DEFAULT =
  process.env.AI_PROVIDER_DEFAULT === "ollama" ? "ollama" : "openai";
/** Clerk JWT `nbf` vs server clock; default 5s in SDK is tight for VPS / proxy latency. */
const CLERK_CLOCK_SKEW_MS = Math.min(
  300_000,
  Math.max(
    5_000,
    Number.parseInt(process.env.CLERK_CLOCK_SKEW_IN_MS ?? "", 10) || 300_000,
  ),
);
const clerkAuthorizedParties = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
logger.info(
  {
    clerkClockSkewMs: CLERK_CLOCK_SKEW_MS,
    clerkAuthorizedPartiesCount: clerkAuthorizedParties.length,
  },
  "[aimtutor-ai] Clerk JWT clock skew (nbf tolerance)",
);
if (isProduction && clerkAuthorizedParties.length === 0) {
  logger.warn(
    "[aimtutor-ai] CLERK_AUTHORIZED_PARTIES is empty: set to your HTTPS frontend origin (e.g. https://your-app.vercel.app) if Bearer tokens return 401.",
  );
}

const hasSerpImageKey = Boolean(process.env.SERPAPI_API_KEY?.trim());
if (!hasSerpImageKey) {
  logger.warn(
    "No image search credentials: set SERPAPI_API_KEY (SerpAPI Google Images).",
  );
}

const MERMAID_SYSTEM = `You are a diagram assistant for a whiteboard app. Your reply must be ONLY valid Mermaid diagram source code — no markdown fences, no explanations, no backticks.
Choose an appropriate diagram type (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, pie, etc.).
Keep syntax compatible with Mermaid 10+.`;

function isTransientPgError(err) {
  if (!err) return false;
  const msg = (typeof err.message === "string" ? err.message : "").toLowerCase();
  if (
    msg.includes("connection terminated unexpectedly") ||
    msg.includes("connection terminated due to connection timeout") ||
    msg.includes("connection timeout") ||
    msg.includes("server closed the connection") ||
    msg.includes("econnreset") ||
    msg.includes("read etimedout")
  ) {
    return true;
  }
  if (
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT" ||
    err.code === "EPIPE"
  ) {
    return true;
  }
  return false;
}


async function pgQuery(text, params) {
  let lastErr;
  const maxAttempts = /\.neon\.tech/i.test(process.env.NEON_DATABASE_URL ?? "")
    ? 3
    : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prismaPgQuery(text, params);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1 && isTransientPgError(err)) {
        logger.warn(
          { err, attempt, module: "pgQuery" },
          "retrying postgres query after transient error",
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const appDeps = buildAppDeps({
  pgQuery,
  isAllowedChatImageUrl,
});
const auditV1Requests = createAuditV1Middleware({
  getAuth,
  pgQuery,
});
const aiProviderService = createAiProviderService({
  isProduction,
  aiProviderDefault: AI_PROVIDER_DEFAULT,
  ollamaBaseUrl: OLLAMA_BASE_URL,
  ollamaModel: OLLAMA_MODEL,
  ollamaTimeoutMs: OLLAMA_TIMEOUT_MS,
});
const { probeDbHealth, monitorDbConnectivity } = createDbHealthMonitor({
  prisma,
  logger,
});
const redisCache = createRedisCache({
  logger,
  prefix: process.env.REDIS_CACHE_PREFIX?.trim() || "aifaboard:v1",
  maxEntryBytes: Number.parseInt(process.env.REDIS_CACHE_MAX_ENTRY_BYTES || "", 10) || 65536,
});
if (redisCache.enabled) {
  logger.info("[cache] Upstash Redis cache enabled");
} else {
  logger.info("[cache] Upstash Redis cache disabled (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)");
}

function normalizeCorsOrigin(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().replace(/^\ufeff/, "");
}

function resolveCorsConfig() {
  const raw = normalizeCorsOrigin(process.env.CORS_ORIGINS || "");
  if (raw) {
    const allowed = new Set(
      raw.split(",").map((s) => normalizeCorsOrigin(s)).filter(Boolean),
    );
    if (isProduction) {
      console.log(
        `[aimtutor-ai] CORS: ${allowed.size} allowed origin(s): ${[...allowed].join(", ")}`,
      );
    }
    return {
      origin: (origin, cb) => {
        const o = origin ? normalizeCorsOrigin(origin) : origin;
        if (!o || allowed.has(o)) {
          cb(null, true);
        } else {
          console.warn(
            `[aimtutor-ai] CORS rejected Origin=${JSON.stringify(origin)} (normalized=${JSON.stringify(o)})`,
          );
          cb(null, false);
        }
      },
    };
  }
  if (isProduction) {
    console.error(
      "[aimtutor-ai] CORS_ORIGINS must be set in production (comma-separated origins)",
    );
    return { origin: false };
  }
  return { origin: true };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function publicErrorMessage(err) {
  if (!isProduction) {
    return err?.message || "Request failed";
  }
  return "Request failed";
}

const app = express();
if (trustProxy) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    ...resolveCorsConfig(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization"],
    credentials: false,
    maxAge: 86_400,
  }),
);
app.use(express.json({ limit: "32mb" }));
registerMetricsRoute(app, { logger });
app.use(createHttpMetricsMiddleware());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    const url = req.originalUrl || req.url;
    logger.info(
      `[req] ${req.method} ${url} ${res.statusCode} ${elapsedMs}ms`,
    );
  });
  next();
});

const v1Limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 120 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests" },
});
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isProduction ? 80 : 250,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "AI rate limit exceeded. Try again later." },
});
app.use("/v1", v1Limiter);
app.use("/v1/ai", aiLimiter);

const boardPutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 4000 : 25000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many board saves" },
});

app.use((req, res, next) => {
  // allow public routes (metrics: optional bearer — see METRICS_SCRAPE_TOKEN)
  if (req.path.startsWith("/health") || req.path === "/metrics") {
    return next();
  }

  const clerkOpts = { clockSkewInMs: CLERK_CLOCK_SKEW_MS };
  if (clerkAuthorizedParties.length > 0) {
    clerkOpts.authorizedParties = clerkAuthorizedParties;
  }
  return clerkMiddleware(clerkOpts)(req, res, next);
});
/** Runtime evidence when Clerk leaves Bearer sessions unsigned-in (nbf, azp, keys, clock). */
app.use((req, res, next) => {
  if (!req.path.startsWith("/v1")) {
    return next();
  }
  const hasBearer =
    typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ");
  if (!hasBearer) {
    return next();
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    logger.warn(
      {
        path: req.path,
        sessionId: auth?.sessionId ?? null,
        orgId: auth?.orgId ?? null,
        origin: req.headers.origin ?? null,
        host: req.headers.host ?? null,
      },
      "[clerk] Bearer present but no userId after middleware",
    );
  }
  next();
});
app.use(auditV1Requests);

function requireDatabase(res) {
  if (!process.env.NEON_DATABASE_URL) {
    res.locals.auditError = "NEON_DATABASE_URL is not set";
    res.status(500).json({
      message: isProduction
        ? "Server configuration error"
        : "NEON_DATABASE_URL is not set. Add it to .env.development.local in the repo root.",
    });
    return false;
  }
  return true;
}



async function logUsage({
  userId,
  endpoint,
  model,
  promptTokens = null,
  completionTokens = null,
}) {
  if (!process.env.NEON_DATABASE_URL) {
    return;
  }
  try {
    await pgQuery(
      `
      INSERT INTO ai_usage_events (user_id, endpoint, model, prompt_tokens, completion_tokens)
      VALUES ($1::bigint, $2, $3, $4, $5);
    `,
      [userId, endpoint, model, promptTokens, completionTokens],
    );
    recordOpenAiTokens(endpoint, promptTokens, completionTokens, model);
  } catch (err) {
    logger.warn(
      { err, endpoint, module: "logUsage" },
      "Failed to record AI usage (non-fatal)",
    );
  }
}

registerRoutes({
  app,
  asyncRoute,
  probeDbHealth,
  boardPutLimiter,
  requireDatabase,
  appDeps: {
    ...appDeps,
    pgQuery,
    prisma,
    redisCache,
    defaultEmptyScene,
    sceneToGzipBuffer,
    gzipBufferToScene,
  },
  aiDeps: {
    ...aiProviderService,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    ollamaTimeoutMs: OLLAMA_TIMEOUT_MS,
    model: MODEL,
    visionModel: VISION_MODEL,
    mermaidSystem: MERMAID_SYSTEM,
    logUsage,
    publicErrorMessage,
    parseSidebarChatMode,
    buildSidebarOpenAIMessages,
    runSidebarImagePipeline: (args) =>
      runSidebarImagePipeline({
        ...args,
        ollamaBaseUrl: OLLAMA_BASE_URL,
        defaultModel: MODEL,
        logger,
      }),
    sidebarImagesOnlyMaxReferenceImages:
      SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
    sidebarTopicPlusImagesMaxReferenceImages:
      SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
  },
});


app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err, req, res, _next) => {
  (req.log || logger).error(
    {
      method: req.method,
      url: req.originalUrl || req.url,
      error: err?.message || "unhandled error",
      stack: err?.stack,
    },
    "[error]",
  );
  if (res.headersSent) {
    return;
  }
  const status = Number(err?.statusCode || err?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: publicErrorMessage(err),
  });
});

startServer({
  ensureSchema,
  monitorDbConnectivity,
  app,
  logger,
  isProduction,
  host: LISTEN_HOST,
  port: PORT,
  attachRealtimeServer,
  prisma,
  routes: routeManifest,
});
