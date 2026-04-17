import path from "node:path";
import { fileURLToPath } from "node:url";

import { clerkMiddleware, getAuth } from "@clerk/express";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import OpenAI from "openai";

import { ensureSchema } from "./db/ensureSchema.mjs";
import { getPrisma, pgQuery as prismaPgQuery } from "./db/prismaClient.mjs";
import { createAuthHelpers, parseActivityEvents } from "./services/auth/authService.mjs";
import { createMessageParsers } from "./services/chat/messageParsers.mjs";
import {
  createOwnershipQueries,
  defaultEmptyScene,
  gzipBufferToScene,
  sceneToGzipBuffer,
} from "./services/db/boardData.mjs";
import { isAllowedChatImageUrl } from "./lib/googleImageSearch.mjs";
import { logger } from "./lib/logger.mjs";
import { createAuditV1Middleware } from "./middleware/auditV1.mjs";
import { attachRealtimeServer } from "./realtime/socketServer.mjs";
import { startServer } from "./bootstrap/startServer.mjs";
import { createSystemRoutes } from "./routes/systemRoutes.mjs";
import { createV1AiRoutes } from "./routes/v1AiRoutes.mjs";
import { createV1BoardRoutes } from "./routes/v1BoardRoutes.mjs";
import { createV1UserRoutes } from "./routes/v1UserRoutes.mjs";
import { createV1WorkspaceRoutes } from "./routes/v1WorkspaceRoutes.mjs";
import {
  buildSidebarOpenAIMessages,
  parseSidebarChatMode,
  runSidebarImagePipeline,
  SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
  SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
} from "./services/ai/sidebarChat.mjs";

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
const prisma = getPrisma();

const isProduction = process.env.NODE_ENV === "production";
/** Render (and similar) sit behind a reverse proxy; rate limiting and IPs need this. */
const trustProxy =
  process.env.TRUST_PROXY === "1" || process.env.RENDER === "true";

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

function parseAiProvider(body) {
  const raw = typeof body?.provider === "string" ? body.provider.trim() : "";
  if (raw === "ollama" || raw === "gpu") {
    return "ollama";
  }
  if (raw === "openai") {
    return "openai";
  }
  return AI_PROVIDER_DEFAULT;
}

function parseAiModel(body, provider, fallback) {
  const fromBody =
    typeof body?.model === "string" ? body.model.trim().slice(0, 120) : "";
  if (fromBody) return fromBody;
  if (provider === "ollama") return OLLAMA_MODEL;
  return fallback;
}

function requireAiProvider(res, provider) {
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      res.locals.auditError = "OPENAI_API_KEY is not set";
      res.status(500).json({
        message: isProduction
          ? "Server configuration error"
          : "OPENAI_API_KEY is not set. Add it to .env.development.local in the repo root.",
      });
      return false;
    }
    return true;
  }
  if (!OLLAMA_BASE_URL) {
    res.locals.auditError = "OLLAMA_BASE_URL is not set";
    res.status(500).json({
      message: isProduction
        ? "Server configuration error"
        : "OLLAMA_BASE_URL is not set. Add it to .env.development.local in the repo root.",
    });
    return false;
  }
  return true;
}

function createOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function ollamaChatNonStreaming({
  model,
  messages,
  temperature = 0.7,
  maxTokens = 2048,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const resp = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature, num_predict: maxTokens },
        messages,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama error ${resp.status}: ${body || resp.statusText}`);
    }
    const data = await resp.json();
    return String(data?.message?.content ?? data?.response ?? "");
  } finally {
    clearTimeout(timeout);
  }
}

async function* ollamaChatStreaming({
  model,
  messages,
  temperature = 0.7,
  maxTokens = 2048,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const resp = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: true,
        options: { temperature, num_predict: maxTokens },
        messages,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ollama error ${resp.status}: ${body || resp.statusText}`);
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      throw new Error("No Ollama response stream");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const delta = String(parsed?.message?.content ?? parsed?.response ?? "");
        if (delta) {
          yield delta;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

const hasSerpImageKey = Boolean(process.env.SERPAPI_API_KEY?.trim());
const hasGoogleImageKeys =
  Boolean(process.env.GOOGLE_API_KEY?.trim()) &&
  Boolean(process.env.GOOGLE_CX?.trim());
if (!hasSerpImageKey && !hasGoogleImageKeys) {
  logger.warn(
    "No image search credentials: set SERPAPI_API_KEY (SerpAPI Google Images) or GOOGLE_API_KEY + GOOGLE_CX (Custom Search).",
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

let dbConnectionHealthy = null;

async function probeDbHealth() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err?.message || "database probe failed",
    };
  }
}

async function monitorDbConnectivity() {
  if (!process.env.NEON_DATABASE_URL) {
    return;
  }
  const status = await probeDbHealth();
  if (dbConnectionHealthy === status.ok) {
    return;
  }
  dbConnectionHealthy = status.ok;
  if (status.ok) {
    logger.info(
      {
        module: "dbMonitor",
        latencyMs: status.latencyMs,
      },
      "[db] connected",
    );
  } else {
    logger.error(
      {
        module: "dbMonitor",
        latencyMs: status.latencyMs,
        error: status.error,
      },
      "[db] down",
    );
  }
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

const {
  ensureDefaultWorkspace,
  assertWorkspaceOwned,
  assertFolderOwned,
  assertBoardOwned,
  assertBoardAiSessionOwned,
} = createOwnershipQueries({ pgQuery });
const {
  sanitizeChatImagesArray,
  parseSidebarChatMessagesArray,
  parseContextMessagesJson,
} = createMessageParsers({ isAllowedChatImageUrl });
const { requireAuthApi, upsertUserFromAuth } = createAuthHelpers({
  getAuth,
  pgQuery,
});
const auditV1Requests = createAuditV1Middleware({ getAuth, pgQuery });

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
  max: isProduction ? 40 : 250,
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

// app.use(clerkMiddleware());
app.use((req, res, next) => {
  // allow public routes
  if (req.path.startsWith("/health")) {
    return next();
  }

  // apply Clerk only for others
  return clerkMiddleware()(req, res, next);
});
app.use(auditV1Requests);
app.use(
  createSystemRoutes({
    asyncRoute,
    probeDbHealth,
  }),
);

function requireApiKey(res) {
  if (!process.env.OPENAI_API_KEY) {
    res.locals.auditError = "OPENAI_API_KEY is not set";
    res.status(500).json({
      message: isProduction
        ? "Server configuration error"
        : "OPENAI_API_KEY is not set. Add it to .env.development.local in the repo root.",
    });
    return false;
  }
  return true;
}

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
      VALUES ($1, $2, $3, $4, $5);
    `,
      [userId, endpoint, model, promptTokens, completionTokens],
    );
  } catch (err) {
    logger.warn(
      { err, endpoint, module: "logUsage" },
      "Failed to record AI usage (non-fatal)",
    );
  }
}

app.use(
  createV1UserRoutes({
    asyncRoute,
    requireDatabase,
    requireAuthApi,
    upsertUserFromAuth,
    parseActivityEvents,
    pgQuery,
  }),
);

app.use(
  createV1WorkspaceRoutes({
    asyncRoute,
    requireDatabase,
    requireAuthApi,
    upsertUserFromAuth,
    ensureDefaultWorkspace,
    assertWorkspaceOwned,
    assertFolderOwned,
    pgQuery,
  }),
);
app.use(
  createV1BoardRoutes({
    asyncRoute,
    boardPutLimiter,
    requireDatabase,
    requireAuthApi,
    upsertUserFromAuth,
    assertFolderOwned,
    assertBoardOwned,
    assertBoardAiSessionOwned,
    defaultEmptyScene,
    sceneToGzipBuffer,
    gzipBufferToScene,
    parseSidebarChatMessagesArray,
    parseContextMessagesJson,
    sanitizeChatImagesArray,
    pgQuery,
    prisma,
  }),
);
app.use(
  createV1AiRoutes({
    asyncRoute,
    requireDatabase,
    requireAuthApi,
    requireAiProvider,
    upsertUserFromAuth,
    parseAiProvider,
    parseAiModel,
    createOpenAIClient,
    ollamaChatStreaming,
    ollamaChatNonStreaming,
    OLLAMA_BASE_URL,
    OLLAMA_TIMEOUT_MS,
    MODEL,
    VISION_MODEL,
    MERMAID_SYSTEM,
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
    SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
    SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
  }),
);


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
  routes: [
    "GET    /health",
    "GET    /health/db",
    "GET    /v1/auth/me",
    "POST   /v1/activity",
    "GET    /v1/workspaces",
    "PATCH  /v1/workspaces/:workspaceId",
    "POST   /v1/workspaces/:workspaceId/folders",
    "GET    /v1/workspaces/:workspaceId/folders",
    "PATCH  /v1/folders/:folderId",
    "DELETE /v1/folders/:folderId",
    "POST   /v1/folders/:folderId/boards",
    "GET    /v1/folders/:folderId/boards",
    "GET    /v1/boards/:boardId",
    "PUT    /v1/boards/:boardId",
    "PATCH  /v1/boards/:boardId",
    "DELETE /v1/boards/:boardId",
    "GET    /v1/boards/:boardId/ai-chats",
    "GET    /v1/boards/:boardId/ai-chats/:sessionId",
    "POST   /v1/boards/:boardId/ai-chats",
    "PUT    /v1/boards/:boardId/ai-chats/:sessionId",
    "DELETE /v1/boards/:boardId/ai-chats/:sessionId",
    "GET    /v1/ai/ollama/models",
    "POST   /v1/ai/text-to-diagram/chat-streaming",
    "POST   /v1/ai/sidebar-chat-streaming",
    "POST   /v1/ai/sidebar-chat",
    "POST   /v1/ai/diagram-to-code/generate",
  ],
});
