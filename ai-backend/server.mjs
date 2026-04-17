import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { Server as SocketIOServer } from "socket.io";
import { clerkMiddleware, getAuth } from "@clerk/express";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import OpenAI from "openai";
import pg from "pg";

import {
  fetchImagesWithMetaFromQueries,
  isAllowedChatImageUrl,
} from "./lib/googleImageSearch.mjs";
import {
  expandImageSearchQueriesOllama,
  expandImageSearchQueriesOpenAI,
} from "./lib/imageQueryOpenAI.mjs";
import { logger } from "./lib/logger.mjs";

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

const { Pool } = pg;

/** Neon / managed Postgres often require TLS even when the URL omits sslmode=require. */
function resolvePgSsl(connectionString) {
  if (!connectionString || typeof connectionString !== "string") {
    return undefined;
  }
  if (process.env.DATABASE_SSL === "0") {
    return undefined;
  }
  if (process.env.DATABASE_SSL === "1") {
    return { rejectUnauthorized: false };
  }
  if (
    /[?&]sslmode=require\b/i.test(connectionString) ||
    /[?&]sslmode=verify-full\b/i.test(connectionString)
  ) {
    return { rejectUnauthorized: false };
  }
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, "https:");
    const host = new URL(normalized).hostname?.toLowerCase() ?? "";
    if (
      host.endsWith(".neon.tech") ||
      host.endsWith(".pooler.supabase.com") ||
      host.endsWith(".supabase.co") ||
      host.includes("aivencloud.com") ||
      host.endsWith(".render.com")
    ) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}

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

/**
 * Neon console URLs often include channel_binding=require; node-pg can fail or drop
 * mid-handshake. Pooler TLS works without it.
 */
function stripChannelBindingFromConnectionString(cs) {
  if (!cs || typeof cs !== "string" || !cs.includes("channel_binding")) {
    return cs;
  }
  const qIdx = cs.indexOf("?");
  if (qIdx === -1) {
    return cs;
  }
  const base = cs.slice(0, qIdx);
  const tail = cs.slice(qIdx + 1);
  const parts = tail.split("&").filter((p) => !/^channel_binding=/i.test(p.trim()));
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/** Neon free tier suspends compute; first connection after idle can take 30–90s+. */
function resolveConnectionTimeoutMillis() {
  const fromEnv = process.env.PG_CONNECTION_TIMEOUT_MS;
  if (fromEnv != null && fromEnv !== "") {
    const n = parseInt(fromEnv, 10);
    if (Number.isFinite(n) && n >= 1000) {
      return n;
    }
  }
  const cs = process.env.NEON_DATABASE_URL ?? "";
  return /\.neon\.tech/i.test(cs) ? 120_000 : 15_000;
}

const pgConnectionString = stripChannelBindingFromConnectionString(
  process.env.NEON_DATABASE_URL,
);

const pool = new Pool({
  connectionString: pgConnectionString,
  ssl: resolvePgSsl(process.env.NEON_DATABASE_URL),
  max: 5,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: resolveConnectionTimeoutMillis(),
});

let dbConnectionHealthy = null;
let dbMonitorInterval = null;

async function probeDbHealth() {
  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1");
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

pool.on("error", (err) => {
  logger.error(
    { err, module: "pgPool" },
    "Unexpected error on idle PostgreSQL client",
  );
});

async function pgQuery(text, params) {
  let lastErr;
  const maxAttempts = /\.neon\.tech/i.test(process.env.NEON_DATABASE_URL ?? "")
    ? 3
    : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await pool.query(text, params);
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

app.get("/", (req, res) => {
  res.json({ message: "Board Backend Running" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "aimtutor-ai-backend" });
});

app.get(
  "/health/db",
  asyncRoute(async (_req, res) => {
    if (!process.env.NEON_DATABASE_URL) {
      res.status(503).json({
        ok: false,
        db: "down",
        message: "NEON_DATABASE_URL is not configured",
      });
      return;
    }
    const status = await probeDbHealth();
    if (status.ok) {
      res.json({
        ok: true,
        db: "up",
        latencyMs: status.latencyMs,
      });
      return;
    }
    res.status(503).json({
      ok: false,
      db: "down",
      latencyMs: status.latencyMs,
      error: status.error,
    });
  }),
);

app.get(
  "/v1/ai/ollama/models",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    if (!requireAiProvider(res, "ollama")) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
      const resp = await fetch(
        `${OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`,
        {
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Ollama tags failed (${resp.status}): ${body}`);
      }
      const data = await resp.json();
      const names = Array.isArray(data?.models)
        ? data.models
            .map((m) => String(m?.name ?? "").trim())
            .filter(Boolean)
            .slice(0, 128)
        : [];
      res.locals.auditDetails = {
        kind: "ai_ollama_models",
        provider: "ollama",
        modelCount: names.length,
      };
      await logUsage({
        userId: localUserId,
        endpoint: "/v1/ai/ollama/models",
        model: "ollama:tags",
      });
      res.json({ models: names });
    } catch (err) {
      res.locals.auditError = err?.message || "Failed to load ollama models";
      res.status(500).json({ message: publicErrorMessage(err) });
    }
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

async function ensureSchema() {
  if (!process.env.NEON_DATABASE_URL) {
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_process_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      clerk_user_id TEXT,
      route TEXT NOT NULL,
      http_method TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      error_message TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_process_logs_user_id ON api_process_logs (user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_process_logs_clerk_user_id ON api_process_logs (clerk_user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_process_logs_created_at ON api_process_logs (created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_process_logs_route ON api_process_logs (route);
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_api_at TIMESTAMPTZ;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_events (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      category TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity_events (user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_clerk_user_id ON user_activity_events (clerk_user_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity_events (created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity_events (action);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'My workspace',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_user_id)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id BIGSERIAL PRIMARY KEY,
      workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspace_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id BIGSERIAL PRIMARY KEY,
      folder_id BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Untitled board',
      scene_gzip BYTEA NOT NULL,
      created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_boards_folder_updated ON boards(folder_id, updated_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_ai_chat_sessions (
      id BIGSERIAL PRIMARY KEY,
      board_id BIGINT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Chat',
      context_messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_board_ai_chat_sessions_board_user_updated
    ON board_ai_chat_sessions(board_id, user_id, updated_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_ai_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES board_ai_chat_sessions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, position)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_board_ai_chat_messages_session_pos
    ON board_ai_chat_messages(session_id, position);
  `);
  await pool.query(`
    ALTER TABLE board_ai_chat_messages
    ADD COLUMN IF NOT EXISTS images_json JSONB
  `);
}

const DEFAULT_SCENE_SOURCE = "https://aimtutor.ai";

function defaultEmptyScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: DEFAULT_SCENE_SOURCE,
    elements: [],
    appState: {},
    files: {},
  };
}

function sceneToGzipBuffer(sceneObj) {
  return gzipSync(Buffer.from(JSON.stringify(sceneObj), "utf8"));
}

function gzipBufferToScene(buf) {
  const raw = gunzipSync(buf).toString("utf8");
  return JSON.parse(raw);
}

async function ensureDefaultWorkspace(localUserId) {
  const { rows } = await pool.query(
    `SELECT id, name, created_at, updated_at FROM workspaces WHERE owner_user_id = $1`,
    [localUserId],
  );
  if (rows.length) {
    return rows[0];
  }
  const ins = await pool.query(
    `INSERT INTO workspaces (owner_user_id, name) VALUES ($1, 'My workspace')
     RETURNING id, name, created_at, updated_at`,
    [localUserId],
  );
  return ins.rows[0];
}

async function assertWorkspaceOwned(workspaceId, localUserId) {
  if (!/^\d+$/.test(String(workspaceId))) return null;
  const { rows } = await pool.query(
    `SELECT id, name, created_at, updated_at FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
    [workspaceId, localUserId],
  );
  return rows[0] ?? null;
}

async function assertFolderOwned(folderId, localUserId) {
  if (!/^\d+$/.test(String(folderId))) return null;
  const { rows } = await pool.query(
    `
    SELECT f.id, f.workspace_id, f.name, f.sort_order, f.created_at, f.updated_at
    FROM folders f
    JOIN workspaces w ON w.id = f.workspace_id
    WHERE f.id = $1 AND w.owner_user_id = $2
    `,
    [folderId, localUserId],
  );
  return rows[0] ?? null;
}

async function assertBoardOwned(boardId, localUserId) {
  if (!/^\d+$/.test(String(boardId))) return null;
  const { rows } = await pool.query(
    `
    SELECT b.id, b.folder_id, b.title, b.scene_gzip, b.created_by_user_id, b.created_at, b.updated_at
    FROM boards b
    JOIN folders f ON f.id = b.folder_id
    JOIN workspaces w ON w.id = f.workspace_id
    WHERE b.id = $1 AND w.owner_user_id = $2
    `,
    [boardId, localUserId],
  );
  return rows[0] ?? null;
}

async function assertBoardAiSessionOwned(sessionId, boardId, localUserId) {
  if (!/^\d+$/.test(String(sessionId))) return null;
  const { rows } = await pool.query(
    `
    SELECT s.id, s.board_id, s.user_id, s.title, s.context_messages_json, s.created_at, s.updated_at
    FROM board_ai_chat_sessions s
    WHERE s.id = $1 AND s.board_id = $2 AND s.user_id = $3
    `,
    [sessionId, boardId, localUserId],
  );
  return rows[0] ?? null;
}

/** Validate assistant image attachments (HTTPS only; block localhost/private hosts). */
function sanitizeChatImagesArray(raw) {
  if (raw == null) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length > 4) {
    return undefined;
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const url = String(item.url ?? "").trim();
    const alt = String(item.alt ?? "Image").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!isAllowedChatImageUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push({ url, alt: alt || "Image" });
  }
  return out.length ? out : undefined;
}

function parseSidebarChatMessagesArray(raw) {
  if (!Array.isArray(raw)) {
    return null;
  }
  if (raw.length > 400) {
    return null;
  }
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return null;
    }
    const role =
      m.role === "assistant"
        ? "assistant"
        : m.role === "user"
          ? "user"
          : null;
    if (!role) {
      return null;
    }
    const row = {
      role,
      content: String(m.content ?? "").slice(0, 12000),
    };
    if (role === "assistant") {
      const imgs = sanitizeChatImagesArray(m.images);
      if (imgs?.length) {
        row.images = imgs;
      }
    }
    out.push(row);
  }
  return out;
}

function parseContextMessagesJson(raw) {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  if (raw.length > 200) {
    return null;
  }
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return null;
    }
    const role =
      m.role === "assistant"
        ? "assistant"
        : m.role === "user"
          ? "user"
          : null;
    if (!role) {
      return null;
    }
    out.push({
      role,
      content: String(m.content ?? "").slice(0, 12000),
    });
  }
  return out;
}

function parseActivityEvents(body) {
  const raw = body?.events;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    return null;
  }
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      return null;
    }
    const action =
      typeof e.action === "string" ? e.action.trim().slice(0, 200) : "";
    if (!action) {
      return null;
    }
    const category =
      typeof e.category === "string" ? e.category.trim().slice(0, 100) : null;
    let metadataJson = null;
    if (e.metadata != null) {
      if (typeof e.metadata !== "object" || Array.isArray(e.metadata)) {
        return null;
      }
      try {
        const s = JSON.stringify(e.metadata);
        metadataJson = s.length > 12_000 ? JSON.stringify({ _truncated: true }) : s;
      } catch {
        return null;
      }
    }
    out.push({ action, category, metadataJson });
  }
  return out.length ? out : null;
}

/** One row per completed /v1/* response: user, route, timing, status, optional AI metadata. */
async function logProcessEntry({
  userId,
  clerkUserId,
  route,
  method,
  statusCode,
  durationMs,
  clientIp,
  userAgent,
  errorMessage,
  details,
}) {
  if (!process.env.NEON_DATABASE_URL) {
    return;
  }
  try {
    await pool.query(
      `
      INSERT INTO api_process_logs (
        user_id, clerk_user_id, route, http_method, status_code, duration_ms,
        client_ip, user_agent, error_message, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);
    `,
      [
        userId,
        clerkUserId,
        route,
        method,
        statusCode,
        durationMs,
        clientIp,
        userAgent?.slice(0, 2000) ?? null,
        errorMessage?.slice(0, 2000) ?? null,
        details == null ? null : JSON.stringify(details),
      ],
    );
  } catch (err) {
    console.error("[audit] logProcessEntry failed", err);
  }
}

async function touchUserLastApi(userId) {
  if (!userId || !process.env.NEON_DATABASE_URL) {
    return;
  }
  try {
    await pool.query(`UPDATE users SET last_api_at = NOW() WHERE id = $1`, [
      userId,
    ]);
  } catch (err) {
    console.error("[audit] touchUserLastApi failed", err);
  }
}

/** Attach after clerkMiddleware: records every /v1/* request when the response ends. */
function auditV1Requests(req, res, next) {
  const pathOnly = (req.originalUrl || req.url || "").split("?")[0];
  if (!pathOnly.startsWith("/v1")) {
    next();
    return;
  }

  const started = Date.now();
  let flushed = false;

  const flush = () => {
    if (flushed) {
      return;
    }
    flushed = true;

    const durationMs = Date.now() - started;
    const auth = getAuth(req);
    const clerkUserId = auth?.userId ?? null;

    void (async () => {
      let localUserId = null;
      if (clerkUserId) {
        try {
          const r = await pool.query(
            `SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1`,
            [clerkUserId],
          );
          localUserId = r.rows[0]?.id ?? null;
        } catch (e) {
          console.error("[audit] user lookup failed", e);
        }
      }

      const xf = req.headers["x-forwarded-for"];
      const clientIp =
        (typeof xf === "string" ? xf.split(",")[0]?.trim() : null) ||
        req.socket?.remoteAddress ||
        null;
      const ua =
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"]
          : null;

      let errorMessage = res.locals.auditError ?? null;
      const details = res.locals.auditDetails ?? null;
      const statusCode = res.statusCode;
      if (statusCode >= 400 && !errorMessage) {
        errorMessage = `HTTP ${statusCode}`;
      }

      await logProcessEntry({
        userId: localUserId,
        clerkUserId,
        route: pathOnly,
        method: req.method,
        statusCode,
        durationMs,
        clientIp,
        userAgent: ua,
        errorMessage,
        details,
      });

      if (localUserId && statusCode < 500) {
        await touchUserLastApi(localUserId);
      }
    })();
  };

  res.on("finish", flush);
  res.on("close", flush);
  next();
}

function requireAuthApi(req, res) {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.locals.auditError = "Unauthorized (no Clerk session)";
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return auth;
}

async function fetchClerkUserName(clerkUserId) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  try {
    const resp = await fetch(
      `https://api.clerk.com/v1/users/${clerkUserId}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return (
      [data.first_name, data.last_name].filter(Boolean).join(" ") ||
      data.username ||
      data.email_addresses?.[0]?.email_address ||
      null
    );
  } catch {
    return null;
  }
}

async function upsertUserFromAuth(auth) {
  const email =
    auth.sessionClaims?.email ||
    auth.sessionClaims?.email_address ||
    auth.sessionClaims?.["email"];
  let name =
    auth.sessionClaims?.full_name ||
    [auth.sessionClaims?.first_name, auth.sessionClaims?.last_name]
      .filter(Boolean)
      .join(" ") ||
    null;
  const avatarUrl = auth.sessionClaims?.image_url || null;

  // Clerk JWTs don't include name claims by default — fall back to REST API
  if (!name) {
    name = await fetchClerkUserName(auth.userId);
  }

  const { rows } = await pgQuery(
    `
      INSERT INTO users (clerk_user_id, email, name, avatar_url, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (clerk_user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = COALESCE(EXCLUDED.name, users.name),
        avatar_url = EXCLUDED.avatar_url,
        updated_at = NOW()
      RETURNING id;
    `,
    [auth.userId, email || null, name, avatarUrl],
  );
  return rows[0].id;
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
    await pool.query(
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

app.get(
  "/v1/auth/me",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const userId = await upsertUserFromAuth(auth);
    const { rows } = await pool.query(
      `SELECT id, clerk_user_id, email, name, avatar_url, created_at, updated_at, last_api_at FROM users WHERE id = $1`,
      [userId],
    );
    res.locals.auditDetails = { kind: "auth_me" };
    res.json({ user: rows[0] });
  }),
);

app.post(
  "/v1/activity",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const events = parseActivityEvents(req.body);
    if (!events) {
      res.locals.auditError = "body.events must be a non-empty array (max 50)";
      res.status(400).json({
        message:
          "body.events must be a non-empty array of { action, category?, metadata? }",
      });
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const placeholders = [];
    const params = [];
    let n = 1;
    for (const ev of events) {
      placeholders.push(
        `($${n++}, $${n++}, $${n++}, $${n++}, $${n++}::jsonb)`,
      );
      params.push(
        localUserId,
        auth.userId,
        ev.action,
        ev.category,
        ev.metadataJson,
      );
    }
    await pool.query(
      `INSERT INTO user_activity_events (user_id, clerk_user_id, action, category, metadata) VALUES ${placeholders.join(", ")}`,
      params,
    );
    res.locals.auditDetails = {
      kind: "user_activity",
      count: events.length,
    };
    res.status(204).end();
  }),
);

// --- Workspaces, folders, boards (personal workspace MVP) ---

app.get(
  "/v1/workspaces",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const row = await ensureDefaultWorkspace(localUserId);
    res.locals.auditDetails = { kind: "workspaces_list" };
    res.json({
      workspaces: [
        {
          id: String(row.id),
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      ],
    });
  }),
);

app.post(
  "/v1/workspaces/:workspaceId/folders",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const workspaceId = req.params.workspaceId;
    const ws = await assertWorkspaceOwned(workspaceId, localUserId);
    if (!ws) {
      res.locals.auditError = "workspace not found";
      res.status(404).json({ message: "Workspace not found" });
      return;
    }
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    if (!name) {
      res.locals.auditError = "folder name required";
      res.status(400).json({ message: "name is required" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO folders (workspace_id, name) VALUES ($1, $2)
       RETURNING id, workspace_id, name, sort_order, created_at, updated_at`,
      [workspaceId, name],
    );
    res.locals.auditDetails = { kind: "folder_create", folderId: rows[0].id };
    res.status(201).json({ folder: serializeFolderRow(rows[0]) });
  }),
);

app.get(
  "/v1/workspaces/:workspaceId/folders",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const workspaceId = req.params.workspaceId;
    const ws = await assertWorkspaceOwned(workspaceId, localUserId);
    if (!ws) {
      res.locals.auditError = "workspace not found";
      res.status(404).json({ message: "Workspace not found" });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT f.id, f.workspace_id, f.name, f.sort_order, f.created_at, f.updated_at,
        (SELECT COUNT(*)::int FROM boards b WHERE b.folder_id = f.id) AS board_count
      FROM folders f
      WHERE f.workspace_id = $1
      ORDER BY f.sort_order ASC, f.created_at ASC
      `,
      [workspaceId],
    );
    res.locals.auditDetails = { kind: "folders_list" };
    res.json({
      folders: rows.map((r) => ({
        ...serializeFolderRow(r),
        boardCount: r.board_count,
      })),
    });
  }),
);

app.patch(
  "/v1/folders/:folderId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const folderId = req.params.folderId;
    const folder = await assertFolderOwned(folderId, localUserId);
    if (!folder) {
      res.locals.auditError = "folder not found";
      res.status(404).json({ message: "Folder not found" });
      return;
    }
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : null;
    const sortOrder =
      typeof req.body?.sortOrder === "number" && Number.isFinite(req.body.sortOrder)
        ? Math.trunc(req.body.sortOrder)
        : null;
    if (!name && sortOrder === null) {
      res.status(400).json({ message: "Provide name and/or sortOrder" });
      return;
    }
    const { rows } = await pool.query(
      `
      UPDATE folders SET
        name = COALESCE($2, name),
        sort_order = COALESCE($3, sort_order),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, workspace_id, name, sort_order, created_at, updated_at
      `,
      [folderId, name, sortOrder],
    );
    res.locals.auditDetails = { kind: "folder_patch" };
    res.json({ folder: serializeFolderRow(rows[0]) });
  }),
);

app.delete(
  "/v1/folders/:folderId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const folderId = req.params.folderId;
    const folder = await assertFolderOwned(folderId, localUserId);
    if (!folder) {
      res.locals.auditError = "folder not found";
      res.status(404).json({ message: "Folder not found" });
      return;
    }
    await pool.query(`DELETE FROM folders WHERE id = $1`, [folderId]);
    res.locals.auditDetails = { kind: "folder_delete" };
    res.status(204).end();
  }),
);

app.post(
  "/v1/folders/:folderId/boards",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const folderId = req.params.folderId;
    const folder = await assertFolderOwned(folderId, localUserId);
    if (!folder) {
      res.locals.auditError = "folder not found";
      res.status(404).json({ message: "Folder not found" });
      return;
    }
    const titleRaw =
      typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
    const title = titleRaw || "Untitled board";
    const gzip = sceneToGzipBuffer(defaultEmptyScene());
    const { rows } = await pool.query(
      `INSERT INTO boards (folder_id, title, scene_gzip, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, folder_id, title, created_at, updated_at`,
      [folderId, title, gzip, localUserId],
    );
    res.locals.auditDetails = { kind: "board_create", boardId: rows[0].id };
    res.status(201).json({ board: serializeBoardListRow(rows[0], null) });
  }),
);

app.get(
  "/v1/folders/:folderId/boards",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const folderId = req.params.folderId;
    const folder = await assertFolderOwned(folderId, localUserId);
    if (!folder) {
      res.locals.auditError = "folder not found";
      res.status(404).json({ message: "Folder not found" });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT b.id, b.folder_id, b.title, b.created_at, b.updated_at,
        u.name AS author_name, u.email AS author_email
      FROM boards b
      LEFT JOIN users u ON u.id = b.created_by_user_id
      WHERE b.folder_id = $1
      ORDER BY b.updated_at DESC
      `,
      [folderId],
    );
    res.locals.auditDetails = { kind: "boards_list" };
    res.json({
      boards: rows.map((r) => serializeBoardListRow(r, r.author_name || r.author_email)),
    });
  }),
);

app.get(
  "/v1/boards/:boardId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    let scene;
    try {
      scene = gzipBufferToScene(board.scene_gzip);
    } catch (e) {
      res.locals.auditError = "corrupt scene";
      res.status(500).json({ message: "Board data could not be read" });
      return;
    }
    res.locals.auditDetails = { kind: "board_get" };
    res.json({
      board: {
        id: String(board.id),
        folderId: String(board.folder_id),
        title: board.title,
        createdAt: board.created_at,
        updatedAt: board.updated_at,
      },
      scene,
    });
  }),
);

app.put(
  "/v1/boards/:boardId",
  boardPutLimiter,
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const scene = req.body?.scene;
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      res.locals.auditError = "invalid scene";
      res.status(400).json({ message: "body.scene must be an object" });
      return;
    }
    const expected =
      typeof req.body?.expectedUpdatedAt === "string"
        ? req.body.expectedUpdatedAt
        : null;
    if (expected) {
      const prevIso = new Date(board.updated_at).toISOString();
      if (prevIso !== expected) {
        res.locals.auditError = "version conflict";
        res.status(409).json({
          message: "Board was modified elsewhere. Reload and try again.",
          currentUpdatedAt: prevIso,
        });
        return;
      }
    }
    let gzip;
    try {
      gzip = sceneToGzipBuffer(scene);
    } catch (e) {
      res.locals.auditError = "scene serialize failed";
      res.status(400).json({ message: "Could not store scene" });
      return;
    }
    const maxBytes = parseInt(process.env.BOARD_SCENE_MAX_GZIP_BYTES || "12582912", 10);
    if (gzip.length > maxBytes) {
      res.locals.auditError = "scene too large";
      res.status(413).json({ message: "Board is too large to save" });
      return;
    }
    const titleUpd =
      typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : null;
    const { rows } = await pool.query(
      `
      UPDATE boards SET
        scene_gzip = $2,
        title = COALESCE($3, title),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, folder_id, title, created_at, updated_at
      `,
      [boardId, gzip, titleUpd],
    );
    res.locals.auditDetails = { kind: "board_put" };
    res.json({
      board: {
        id: String(rows[0].id),
        folderId: String(rows[0].folder_id),
        title: rows[0].title,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      },
    });
  }),
);

function serializeFolderRow(r) {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: r.name,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeBoardListRow(r, authorLabel) {
  return {
    id: String(r.id),
    folderId: String(r.folder_id),
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: authorLabel || null,
  };
}

app.patch(
  "/v1/workspaces/:workspaceId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const workspaceId = req.params.workspaceId;
    const ws = await assertWorkspaceOwned(workspaceId, localUserId);
    if (!ws) {
      res.locals.auditError = "workspace not found";
      res.status(404).json({ message: "Workspace not found" });
      return;
    }
    const name =
      typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : null;
    if (!name) {
      res.status(400).json({ message: "name is required" });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE workspaces SET name = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, created_at, updated_at`,
      [workspaceId, name],
    );
    res.locals.auditDetails = { kind: "workspace_patch" };
    res.json({
      workspace: {
        id: String(rows[0].id),
        name: rows[0].name,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      },
    });
  }),
);

app.patch(
  "/v1/boards/:boardId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const title =
      typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : null;
    if (!title) {
      res.status(400).json({ message: "title is required" });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE boards SET title = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, folder_id, title, created_at, updated_at`,
      [boardId, title],
    );
    res.locals.auditDetails = { kind: "board_patch" };
    res.json({ board: serializeBoardListRow(rows[0], null) });
  }),
);

app.delete(
  "/v1/boards/:boardId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    await pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
    res.locals.auditDetails = { kind: "board_delete", boardId };
    res.status(204).end();
  }),
);

app.get(
  "/v1/boards/:boardId/ai-chats",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT s.id, s.title, s.created_at, s.updated_at,
        (SELECT COUNT(*)::int FROM board_ai_chat_messages m WHERE m.session_id = s.id) AS message_count
      FROM board_ai_chat_sessions s
      WHERE s.board_id = $1 AND s.user_id = $2
      ORDER BY s.updated_at DESC
      LIMIT 100
      `,
      [boardId, localUserId],
    );
    res.locals.auditDetails = { kind: "board_ai_chats_list" };
    res.json({
      sessions: rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.message_count,
      })),
    });
  }),
);

app.get(
  "/v1/boards/:boardId/ai-chats/:sessionId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const sessionId = req.params.sessionId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
    if (!session) {
      res.locals.auditError = "chat session not found";
      res.status(404).json({ message: "Chat session not found" });
      return;
    }
    let contextMessages = [];
    try {
      const raw = session.context_messages_json;
      const parsed =
        typeof raw === "string" ? JSON.parse(raw) : raw;
      const cm = parseContextMessagesJson(parsed);
      if (cm == null) {
        contextMessages = [];
      } else {
        contextMessages = cm;
      }
    } catch {
      contextMessages = [];
    }
    const msgRows = await pool.query(
      `
      SELECT role, content, images_json FROM board_ai_chat_messages
      WHERE session_id = $1
      ORDER BY position ASC
      `,
      [sessionId],
    );
    res.locals.auditDetails = { kind: "board_ai_chat_get" };
    res.json({
      session: {
        id: String(session.id),
        title: session.title,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      contextMessages,
      messages: msgRows.rows.map((r) => {
        const msg = { role: r.role, content: r.content };
        if (r.role === "assistant" && r.images_json != null) {
          try {
            const raw =
              typeof r.images_json === "string"
                ? JSON.parse(r.images_json)
                : r.images_json;
            const imgs = sanitizeChatImagesArray(raw);
            if (imgs?.length) {
              msg.images = imgs;
            }
          } catch {
            /* ignore corrupt json */
          }
        }
        return msg;
      }),
    });
  }),
);

app.post(
  "/v1/boards/:boardId/ai-chats",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const titleRaw =
      typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
    const title = titleRaw || "Chat";
    const { rows } = await pool.query(
      `
      INSERT INTO board_ai_chat_sessions (board_id, user_id, title)
      VALUES ($1, $2, $3)
      RETURNING id, title, created_at, updated_at
      `,
      [boardId, localUserId, title],
    );
    const r = rows[0];
    res.locals.auditDetails = { kind: "board_ai_chat_create" };
    res.status(201).json({
      session: {
        id: String(r.id),
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: 0,
      },
    });
  }),
);

app.put(
  "/v1/boards/:boardId/ai-chats/:sessionId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const sessionId = req.params.sessionId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
    if (!session) {
      res.locals.auditError = "chat session not found";
      res.status(404).json({ message: "Chat session not found" });
      return;
    }
    const messages = parseSidebarChatMessagesArray(req.body?.messages);
    if (messages == null) {
      res.locals.auditError = "invalid messages";
      res.status(400).json({ message: "body.messages must be an array of {role, content}" });
      return;
    }
    const contextMessages = parseContextMessagesJson(req.body?.contextMessages);
    if (contextMessages == null) {
      res.locals.auditError = "invalid contextMessages";
      res.status(400).json({
        message: "body.contextMessages must be an array of {role, content}",
      });
      return;
    }
    const titleUpd =
      typeof req.body?.title === "string"
        ? req.body.title.trim().slice(0, 200) || null
        : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM board_ai_chat_messages WHERE session_id = $1`,
        [sessionId],
      );
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const imagesPayload =
          m.role === "assistant" && m.images?.length
            ? JSON.stringify(m.images)
            : null;
        await client.query(
          `
          INSERT INTO board_ai_chat_messages (session_id, position, role, content, images_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [sessionId, i, m.role, m.content, imagesPayload],
        );
      }
      let ctxJson;
      try {
        ctxJson = JSON.stringify(contextMessages);
        if (ctxJson.length > 500_000) {
          throw new Error("context too large");
        }
      } catch (e) {
        await client.query("ROLLBACK");
        res.locals.auditError = "context serialize failed";
        res.status(400).json({ message: "contextMessages too large" });
        return;
      }
      await client.query(
        `
        UPDATE board_ai_chat_sessions
        SET
          title = COALESCE($2, title),
          context_messages_json = $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        `,
        [sessionId, titleUpd, ctxJson],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pool.query(
      `SELECT id, title, created_at, updated_at FROM board_ai_chat_sessions WHERE id = $1`,
      [sessionId],
    );
    const r = rows[0];
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM board_ai_chat_messages WHERE session_id = $1`,
      [sessionId],
    );
    res.locals.auditDetails = { kind: "board_ai_chat_put" };
    res.json({
      session: {
        id: String(r.id),
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: cnt.rows[0]?.c ?? 0,
      },
    });
  }),
);

app.delete(
  "/v1/boards/:boardId/ai-chats/:sessionId",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) return;
    const auth = requireAuthApi(req, res);
    if (!auth) return;
    const localUserId = await upsertUserFromAuth(auth);
    const boardId = req.params.boardId;
    const sessionId = req.params.sessionId;
    const board = await assertBoardOwned(boardId, localUserId);
    if (!board) {
      res.locals.auditError = "board not found";
      res.status(404).json({ message: "Board not found" });
      return;
    }
    const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
    if (!session) {
      res.locals.auditError = "chat session not found";
      res.status(404).json({ message: "Chat session not found" });
      return;
    }
    await pool.query(`DELETE FROM board_ai_chat_sessions WHERE id = $1`, [sessionId]);
    res.locals.auditDetails = { kind: "board_ai_chat_delete", sessionId };
    res.status(204).end();
  }),
);

app.post(
  "/v1/ai/text-to-diagram/chat-streaming",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }

    const { messages } = req.body ?? {};
    if (!Array.isArray(messages)) {
      res.locals.auditError = "body.messages must be an array";
      res.status(400).json({ message: "body.messages must be an array" });
      return;
    }
    const provider = parseAiProvider(req.body);
    if (!requireAiProvider(res, provider)) {
      return;
    }
    const model = parseAiModel(req.body, provider, MODEL);
    const localUserId = await upsertUserFromAuth(auth);
    const openai = provider === "openai" ? createOpenAIClient() : null;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const sendSse = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    try {
      const normalizedMessages = [
        { role: "system", content: MERMAID_SYSTEM },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? ""),
        })),
      ];

      let promptTokens = null;
      let completionTokens = null;
      let emittedContent = false;
      if (provider === "ollama") {
        for await (const delta of ollamaChatStreaming({
          model,
          messages: normalizedMessages,
          maxTokens: 2048,
          temperature: 0.7,
        })) {
          if (delta) {
            sendSse({ type: "content", delta });
            emittedContent = true;
          }
        }
        if (!emittedContent) {
          const fallbackText = await ollamaChatNonStreaming({
            model,
            messages: normalizedMessages,
            maxTokens: 2048,
            temperature: 0.7,
          });
          if (fallbackText) {
            sendSse({ type: "content", delta: fallbackText });
            emittedContent = true;
          }
        }
      } else {
        const stream = await openai.chat.completions.create({
          model,
          stream: true,
          messages: normalizedMessages,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          promptTokens = chunk?.usage?.prompt_tokens ?? promptTokens;
          completionTokens = chunk?.usage?.completion_tokens ?? completionTokens;
          if (delta) {
            sendSse({ type: "content", delta });
            emittedContent = true;
          }
        }
      }
      await logUsage({
        userId: localUserId,
        endpoint: "/v1/ai/text-to-diagram/chat-streaming",
        model,
        promptTokens,
        completionTokens,
      });

      res.locals.auditDetails = {
        kind: "ai_text_to_diagram_stream",
        provider,
        model,
        promptTokens,
        completionTokens,
        messageCount: messages.length,
      };

      sendSse({ type: "done", finishReason: "stop" });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      const internal = err?.message || "OpenAI request failed";
      res.locals.auditError = internal;
      res.locals.auditDetails = {
        kind: "ai_text_to_diagram_stream",
        provider,
        model,
        failed: true,
      };
      sendSse({
        type: "error",
        error: {
          message: publicErrorMessage(err),
          status: err?.status ?? 500,
        },
      });
      res.end();
    }
  }),
);

const SIDEBAR_CHAT_SYSTEM = `You are AimTutor's teaching-planning assistant inside AimTutor.ai, a collaborative whiteboard app.

Your user is a **tutor or teacher** planning what to teach on the whiteboard—not a student who needs a Wikipedia-style explanation.

## Highest-priority rule: subject / unit / course-area messages
If the user names or asks about a **subject, unit, topic area, or course theme**—including very short messages (e.g. "statistics and probability", "linear equations", "photosynthesis")—you must **not** answer with:
- textbook-style **definitions** of the field ("X is the branch of mathematics that…"),
- long introductory paragraphs about what the field *is*,
- generic encouragement ("feel free to ask") **unless** you have **already** delivered the full roadmap below.

**Start the answer immediately** with structured lesson planning. Your **first heading** must be \`## Scope\` (or equivalent)—not a definition block.

### Required structure (use Markdown, be scannable)
1. **## Scope** — At most 1–2 sentences: what you are covering + assumed level if unknown.
2. **## Teachable units** — **Ordered numbered main units** (e.g. 1., 2., 3.). Under **each** unit, **bullets** with **specific subtopics or skills** to teach (outcome-style is good: "Learners can compute conditional probability").
3. **## Suggested sequence** — Prerequisites, what to teach first vs later (short).
4. **## Teaching hooks** (optional, short) — Misconceptions + 1–2 whiteboard ideas.

Aim for **at least 6–10 distinct subtopics** across the units for a broad area like statistics and probability (unless the user asked for a narrow slice). Depth should support **multiple sessions**, not one paragraph.

## When the message is clearly NOT a subject roadmap request
Examples: how to use the app, one specific homework problem, "what does this symbol mean", clarifying a single diagram.

Then answer **directly and concisely** without the full roadmap.

## Style
Pedagogically sound, neutral tone. Do not invent official syllabi or exam boards unless named; state level assumptions once.

## Reference images (automatic)
For **every** user turn, the app uses an internal **OpenAI step** to derive several image search queries from the conversation, runs **web image search**, and shows up to **four** thumbnails in the sidebar (they may appear **while** your reply streams, not only after).

In your reply:
- Assume relevant reference images **will appear** beside the message; tie your explanation to **visual teaching** when it helps (diagrams, setups, examples).
- Do **not** include Markdown images (\`![alt](url)\`), raw image URLs, numbered link lists, or JSON. You may briefly mention what the gallery illustrates (e.g. “see the vector diagrams in the references”).`;

const SIDEBAR_CHAT_SYSTEM_CHAT = `You are AimTutor's teaching assistant in a sidebar chat beside a collaborative whiteboard.

The user is a **tutor or teacher**. Earlier messages in this thread may contain a structured **roadmap** (Scope, teachable units, sequence, hooks). Your job in this **chat** mode is to **continue that conversation**: clarify units, deepen subtopics, suggest whiteboard activities, address misconceptions, reorder emphasis, answer follow-up questions, or connect to the next lesson.

## Rules
- **Do not** restart from scratch with a full new roadmap unless the user clearly asks for a fresh plan for a **new** subject or unit.
- Use **Markdown** when helpful (short headings, bullets). Be concise unless the user asks for depth.
- This mode does **not** attach automatic reference thumbnails. Do **not** rely on images, and do **not** output Markdown images (\`![alt](url)\`), raw image URLs, or image JSON.
- Stay grounded in what was already said in the thread; ask one clarifying question if needed.`;

/** @returns {"topic_plus_images" | "images" | "chat"} */
function parseSidebarChatMode(body) {
  const raw = typeof body?.mode === "string" ? body.mode.trim() : "";
  if (raw === "images" || raw === "chat" || raw === "topic_plus_images") {
    return raw;
  }
  return "topic_plus_images";
}

/** OpenAI messages for sidebar chat (system + trimmed history). */
function buildSidebarOpenAIMessages(trimmed, mode) {
  const system =
    mode === "chat" ? SIDEBAR_CHAT_SYSTEM_CHAT : SIDEBAR_CHAT_SYSTEM;
  return [
    { role: "system", content: system },
    ...trimmed.map((m) => ({ role: m.role, content: m.content })),
  ];
}

function hasSidebarImageSearchCredentials() {
  const hasSerp = Boolean(process.env.SERPAPI_API_KEY?.trim());
  const hasGoogle =
    Boolean(process.env.GOOGLE_API_KEY?.trim()) &&
    Boolean(process.env.GOOGLE_CX?.trim());
  return hasSerp || hasGoogle;
}

/**
 * Derive a single search string from the last user message (and sometimes the prior turn).
 * Used on every assistant response so thumbnails match the conversation topic.
 */
function fallbackImageSearchQuery(trimmed) {
  const users = trimmed.filter((m) => m.role === "user");
  const last = String(users[users.length - 1]?.content ?? "").trim();
  const prev =
    users.length >= 2
      ? String(users[users.length - 2]?.content ?? "").trim()
      : "";
  const normalizedLast = last.toLowerCase().replace(/[.!?]+$/g, "").trim();
  const isGenericFollowUp = /^(ok|okay|k|yes|yep|sure|continue|go on|next|more|same|keep going|continue please|more please|again)$/i.test(
    normalizedLast,
  );
  const shortVisualOnly =
    last.length < 56 &&
    /\b(image|images|diagram|picture|pictures|photo|photos|visual)\b/i.test(
      last,
    );
  if (shortVisualOnly && prev.length > 2) {
    return prev.slice(0, 200);
  }
  // Short generic follow-ups ("ok", "more", "yes"): keep images aligned with the prior topic.
  // But explicit short topic shifts like "docker" should use the new prompt.
  if (isGenericFollowUp && prev.length > 10) {
    return prev.slice(0, 200);
  }
  return (last || "teaching reference").slice(0, 200);
}

const SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES = 10;
const SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES = 4;

/**
 * LLM query expansion + Serp/Google image fetch.
 * Streaming route runs this in parallel with the assistant text stream; SSE `images` is sent when this resolves.
 * @returns {Promise<{ items: any[]; expansionUsage: { prompt_tokens: number; completion_tokens: number } | null }>}
 */
async function runSidebarImagePipeline({
  provider,
  openai,
  model,
  trimmed,
  maxReferenceImages = 4,
}) {
  if (!hasSidebarImageSearchCredentials()) {
    return { items: [], expansionUsage: null };
  }
  const topicSeed = fallbackImageSearchQuery(trimmed);
  const imageQueryModel = model || process.env.OPENAI_IMAGE_QUERY_MODEL?.trim() || MODEL;
  let expansionResult;
  if (provider === "ollama") {
    expansionResult = await expandImageSearchQueriesOllama(
      OLLAMA_BASE_URL,
      { trimmed, topicSeed },
      imageQueryModel,
    );
  } else {
    expansionResult = await expandImageSearchQueriesOpenAI(
      openai,
      { trimmed, topicSeed },
      imageQueryModel,
    );
  }
  const { queries, usage: expansionUsage } = expansionResult;
  try {
    const { items } = await fetchImagesWithMetaFromQueries(
      queries,
      maxReferenceImages,
    );
    return {
      items: Array.isArray(items) ? items : [],
      expansionUsage,
    };
  } catch (err) {
    logger.debug(
      { err, module: "sidebarChat" },
      "sidebar image fetch failed (non-fatal)",
    );
    return { items: [], expansionUsage };
  }
}

app.post(
  "/v1/ai/sidebar-chat-streaming",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);

    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.locals.auditError = "sidebar-chat-streaming: messages required";
      res
        .status(400)
        .json({ message: "body.messages must be a non-empty array" });
      return;
    }

    const trimmed = messages
      .slice(-24)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 12000),
      }))
      .filter((m) => m.content.length > 0);

    if (!trimmed.length) {
      res.locals.auditError = "sidebar-chat-streaming: empty content";
      res.status(400).json({ message: "No valid message content" });
      return;
    }

    const provider = parseAiProvider(req.body);
    if (!requireAiProvider(res, provider)) {
      return;
    }
    const model = parseAiModel(req.body, provider, MODEL);
    const openai = provider === "openai" ? createOpenAIClient() : null;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const sendSse = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const mode = parseSidebarChatMode(req.body);

    try {
      let promptTokens = null;
      let completionTokens = null;
      let emittedContent = false;

      if (mode === "images") {
        const { items, expansionUsage } = await runSidebarImagePipeline({
          provider,
          openai,
          model,
          trimmed,
          maxReferenceImages: SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
        });
        if (items.length > 0 && !res.writableEnded) {
          sendSse({ type: "images", images: items });
        }
        if (expansionUsage) {
          promptTokens = expansionUsage.prompt_tokens ?? null;
          completionTokens = expansionUsage.completion_tokens ?? null;
        }
        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/sidebar-chat-streaming",
          model,
          promptTokens,
          completionTokens,
        });
        res.locals.auditDetails = {
          kind: "ai_sidebar_chat_stream",
          provider,
          model,
          messageCount: trimmed.length,
          mode,
          promptTokens,
          completionTokens,
        };
        sendSse({ type: "done", finishReason: "stop" });
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const openaiMessages = buildSidebarOpenAIMessages(trimmed, mode);

      /** Image pipeline only in topic_plus_images mode; SSE thumbnails when ready. */
      const imageJob =
        mode === "topic_plus_images"
          ? runSidebarImagePipeline({
              provider,
              openai,
              model,
              trimmed,
              maxReferenceImages: SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
            })
              .then(({ items, expansionUsage }) => {
                if (items.length > 0 && !res.writableEnded) {
                  sendSse({ type: "images", images: items });
                }
                return { expansionUsage };
              })
              .catch((err) => {
                logger.debug(
                  { err, module: "sidebarChat" },
                  "sidebar image job failed",
                );
                return { expansionUsage: null };
              })
          : Promise.resolve({ expansionUsage: null });

      if (provider === "ollama") {
        for await (const delta of ollamaChatStreaming({
          model,
          messages: openaiMessages,
          maxTokens: 2048,
          temperature: 0.7,
        })) {
          if (delta) {
            sendSse({ type: "content", delta });
            emittedContent = true;
          }
        }
        if (!emittedContent) {
          const fallbackText = await ollamaChatNonStreaming({
            model,
            messages: openaiMessages,
            maxTokens: 2048,
            temperature: 0.7,
          });
          if (fallbackText) {
            sendSse({ type: "content", delta: fallbackText });
            emittedContent = true;
          }
        }
      } else {
        const stream = await openai.chat.completions.create({
          model,
          stream: true,
          messages: openaiMessages,
          max_tokens: 2048,
          temperature: 0.7,
          stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (chunk.usage) {
            promptTokens =
              (promptTokens ?? 0) + (chunk.usage.prompt_tokens ?? 0);
            completionTokens =
              (completionTokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
          }
          if (delta) {
            sendSse({ type: "content", delta });
            emittedContent = true;
          }
        }
      }

      const { expansionUsage: imageExpansionUsage } = await imageJob;
      if (imageExpansionUsage) {
        promptTokens =
          (promptTokens ?? 0) + (imageExpansionUsage.prompt_tokens ?? 0);
        completionTokens =
          (completionTokens ?? 0) +
          (imageExpansionUsage.completion_tokens ?? 0);
      }

      await logUsage({
        userId: localUserId,
        endpoint: "/v1/ai/sidebar-chat-streaming",
        model,
        promptTokens,
        completionTokens,
      });
      res.locals.auditDetails = {
        kind: "ai_sidebar_chat_stream",
        provider,
        model,
        messageCount: trimmed.length,
        mode,
        promptTokens,
        completionTokens,
      };
      sendSse({ type: "done", finishReason: "stop" });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      res.locals.auditError = err?.message || "sidebar chat stream failed";
      res.locals.auditDetails = {
        kind: "ai_sidebar_chat_stream",
        provider,
        model,
        failed: true,
      };
      sendSse({
        type: "error",
        error: {
          message: publicErrorMessage(err),
          status: err?.status ?? 500,
        },
      });
      res.end();
    }
  }),
);

app.post(
  "/v1/ai/sidebar-chat",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const localUserId = await upsertUserFromAuth(auth);

    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.locals.auditError = "sidebar-chat: messages required";
      res
        .status(400)
        .json({ message: "body.messages must be a non-empty array" });
      return;
    }

    const trimmed = messages
      .slice(-24)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 12000),
      }))
      .filter((m) => m.content.length > 0);

    if (!trimmed.length) {
      res.locals.auditError = "sidebar-chat: empty content";
      res.status(400).json({ message: "No valid message content" });
      return;
    }

    const provider = parseAiProvider(req.body);
    if (!requireAiProvider(res, provider)) {
      return;
    }
    const model = parseAiModel(req.body, provider, MODEL);
    const mode = parseSidebarChatMode(req.body);
    const openai = provider === "openai" ? createOpenAIClient() : null;
    try {
      if (mode === "images") {
        const pipelineResult = await runSidebarImagePipeline({
          provider,
          openai,
          model,
          trimmed,
          maxReferenceImages: SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES,
        });
        const images = pipelineResult.items;
        let promptTokens = pipelineResult.expansionUsage
          ? pipelineResult.expansionUsage.prompt_tokens
          : null;
        let completionTokens = pipelineResult.expansionUsage
          ? pipelineResult.expansionUsage.completion_tokens
          : null;
        await logUsage({
          userId: localUserId,
          endpoint: "/v1/ai/sidebar-chat",
          model,
          promptTokens,
          completionTokens,
        });
        res.locals.auditDetails = {
          kind: "ai_sidebar_chat",
          provider,
          model,
          messageCount: trimmed.length,
          mode,
        };
        res.json({ text: "", images, reply: "" });
        return;
      }

      const openaiMessages = buildSidebarOpenAIMessages(trimmed, mode);
      const runPipeline =
        mode === "topic_plus_images"
          ? runSidebarImagePipeline({
              provider,
              openai,
              model,
              trimmed,
              maxReferenceImages: SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES,
            })
          : Promise.resolve({ items: [], expansionUsage: null });
      const [pipelineResult, completionTextOrObj] = await Promise.all([
        runPipeline,
        provider === "ollama"
          ? ollamaChatNonStreaming({
              model,
              messages: openaiMessages,
              maxTokens: 2048,
              temperature: 0.7,
            })
          : openai.chat.completions.create({
              model,
              messages: openaiMessages,
              max_tokens: 2048,
              temperature: 0.7,
            }),
      ]);
      const images = pipelineResult.items;
      let promptTokens = pipelineResult.expansionUsage
        ? pipelineResult.expansionUsage.prompt_tokens
        : null;
      let completionTokens = pipelineResult.expansionUsage
        ? pipelineResult.expansionUsage.completion_tokens
        : null;

      const reply =
        provider === "ollama"
          ? String(completionTextOrObj ?? "").trim()
          : completionTextOrObj.choices[0]?.message?.content?.trim() ?? "";
      const u2 =
        provider === "openai" ? completionTextOrObj.usage : null;
      if (u2) {
        promptTokens = (promptTokens ?? 0) + (u2.prompt_tokens ?? 0);
        completionTokens = (completionTokens ?? 0) + (u2.completion_tokens ?? 0);
      }

      await logUsage({
        userId: localUserId,
        endpoint: "/v1/ai/sidebar-chat",
        model,
        promptTokens,
        completionTokens,
      });
      res.locals.auditDetails = {
        kind: "ai_sidebar_chat",
        provider,
        model,
        messageCount: trimmed.length,
        mode,
      };
      res.json({ text: reply, images, reply });
    } catch (err) {
      res.locals.auditError = err?.message || "sidebar chat failed";
      res.status(500).json({ message: publicErrorMessage(err) });
    }
  }),
);

app.post(
  "/v1/ai/diagram-to-code/generate",
  asyncRoute(async (req, res) => {
    if (!requireDatabase(res)) {
      return;
    }
    const auth = requireAuthApi(req, res);
    if (!auth) {
      return;
    }
    const provider = parseAiProvider(req.body);
    if (!requireAiProvider(res, provider)) {
      return;
    }
    if (provider === "ollama") {
      res.status(400).json({
        message:
          "diagram-to-code image inference currently requires OpenAI vision. Switch provider to OpenAI for this action.",
      });
      return;
    }
    const model = parseAiModel(req.body, provider, VISION_MODEL);
    const localUserId = await upsertUserFromAuth(auth);

    const { texts, image, theme, canvasContext } = req.body ?? {};
    const textBlock = Array.isArray(texts)
      ? texts.filter(Boolean).join("\n")
      : "";
    const imageUrl = typeof image === "string" ? image : "";

    let canvasContextBlock = "";
    if (canvasContext != null && typeof canvasContext === "object") {
      try {
        canvasContextBlock =
          "Structured canvas context (use with the image; approximate frame size and shape mix):\n" +
          JSON.stringify(canvasContext, null, 2) +
          "\n\n";
      } catch {
        canvasContextBlock = "";
      }
    }

    if (!imageUrl) {
      res.locals.auditError = "missing image in body";
      res.status(400).json({ message: "image (data URL or URL) is required" });
      return;
    }

    const openai = createOpenAIClient();

    const system =
      "You generate a single self-contained HTML document (only HTML, no markdown) that implements the UI or diagram described. Use inline CSS. Theme hint: " +
      String(theme ?? "light");

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  canvasContextBlock +
                  (textBlock
                    ? `Text extracted from shapes inside the frame:\n${textBlock}`
                    : "No separate text was extracted from shapes; rely on the image and canvas context.") +
                  "\n\nTurn this into a single self-contained HTML preview that matches the wireframe.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 4096,
      });

      let html = completion.choices[0]?.message?.content?.trim() ?? "";
      html = html.replace(/^```html\s*/i, "").replace(/\s*```$/i, "");
      if (!html) {
        res.locals.auditError = "Empty model response";
        res.status(500).json({ message: "Empty model response" });
        return;
      }
      await logUsage({
        userId: localUserId,
        endpoint: "/v1/ai/diagram-to-code/generate",
        model,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
      });
      res.locals.auditDetails = {
        kind: "ai_diagram_to_code",
        provider,
        model,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
        theme: theme ?? null,
        textLength: textBlock.length,
        canvasContext: canvasContext != null ? true : false,
      };
      res.json({ html });
    } catch (err) {
      res.locals.auditError = err?.message || "diagram-to-code failed";
      res.locals.auditDetails = {
        kind: "ai_diagram_to_code",
        provider,
        model,
        failed: true,
      };
      res.status(500).json({
        message: publicErrorMessage(err),
      });
    }
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

ensureSchema()
  .then(() => {
    void monitorDbConnectivity();
    dbMonitorInterval = setInterval(() => {
      void monitorDbConnectivity();
    }, 15_000);

    const server = app.listen(PORT, LISTEN_HOST, () => {
      logger.info(
        {
          env: isProduction ? "production" : "development",
          host: LISTEN_HOST,
          port: PORT,
        },
        `[aimtutor-ai] listening http://${LISTEN_HOST}:${PORT}`,
      );
      logger.debug(
        {
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
        },
        "registered v1 routes",
      );
    });

    const io = new SocketIOServer(server, {
      cors: {
        origin: "*", 
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Accept", "Authorization"],
        credentials: false
      },
      transports: ["websocket", "polling"],
      allowEIO3: true
    });

    const SOCKET_ROOMS = new Map();

    io.on("connection", (socket) => {
      // Excalidraw frontend waits for this init signal before emitting join-room
      socket.emit("init-room");

      socket.on("join-room", (roomId) => {
        socket.join(roomId);
        
        let roomSockets = SOCKET_ROOMS.get(roomId);
        if (!roomSockets) {
          roomSockets = new Set();
          SOCKET_ROOMS.set(roomId, roomSockets);
          socket.emit("first-in-room");
        } else if (roomSockets.size === 0) {
          socket.emit("first-in-room");
        }
        roomSockets.add(socket.id);
        
        socket.to(roomId).emit("new-user", socket.id);
        io.in(roomId).emit("room-user-change", Array.from(roomSockets));
      });

      socket.on("server-broadcast", (roomId, encryptedData, iv) => {
        socket.to(roomId).emit("client-broadcast", encryptedData, iv);
      });
      
      socket.on("server-volatile-broadcast", (roomId, encryptedData, iv) => {
        socket.to(roomId).volatile.emit("client-broadcast", encryptedData, iv);
      });

      socket.on("user-follow", (payload) => {
        const rooms = Array.from(socket.rooms);
        if (rooms.length > 1) {
          socket.to(rooms[1]).emit("user-follow-room-change", [socket.id]);
        }
      });

      socket.on("disconnecting", () => {
        for (const roomId of socket.rooms) {
          if (roomId !== socket.id) {
            const roomSockets = SOCKET_ROOMS.get(roomId);
            if (roomSockets) {
              roomSockets.delete(socket.id);
              if (roomSockets.size === 0) {
                SOCKET_ROOMS.delete(roomId);
              } else {
                io.in(roomId).emit("room-user-change", Array.from(roomSockets));
              }
            }
          }
        }
      });
    });

    const shutdown = (signal) => {
      logger.info({ signal }, "[aimtutor-ai] shutting down");
      if (dbMonitorInterval) {
        clearInterval(dbMonitorInterval);
      }
      io.close();
      server.close(() => {
        pool.end(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((error) => {
    const msg = error?.message || String(error);
    if (/data transfer quota/i.test(msg)) {
      logger.fatal(
        {
          err: error,
          remediation:
            "Neon data transfer limit reached: open the Neon project dashboard (Usage / Billing), upgrade the plan or wait for the quota window to reset. The service cannot start until Postgres accepts connections again.",
        },
        "Failed to initialize database schema (hosting quota)",
      );
    } else {
      logger.fatal({ err: error }, "Failed to initialize database schema");
    }
    process.exit(1);
  });
