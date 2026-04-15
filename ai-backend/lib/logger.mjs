/**
 * Structured logging (Pino). Request lines are logged in server.mjs (single-line in dev via pino-pretty).
 * Dev: LOG_PRETTY=1 (default when NODE_ENV is not production) uses pino-pretty if installed (single-line output).
 */
import { createRequire } from "node:module";

import pino from "pino";
import pinoHttp from "pino-http";

const require = createRequire(import.meta.url);
const isProduction = process.env.NODE_ENV === "production";
const wantPretty =
  !isProduction &&
  process.env.LOG_PRETTY !== "0" &&
  process.env.LOG_PRETTY !== "false";

/** @type {import('pino').LoggerOptions} */
const baseOpts = {
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  base: { service: "aimboard-ai-backend" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
    ],
    remove: true,
  },
};

let logger;
if (wantPretty) {
  try {
    require.resolve("pino-pretty");
    logger = pino({
      ...baseOpts,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
          singleLine: true,
        },
      },
    });
  } catch {
    logger = pino(baseOpts);
  }
} else {
  logger = pino(baseOpts);
}

/** @type {import('pino').Logger} */
export { logger };

/**
 * Express middleware: one structured log per request (method, url, status, responseTime, reqId).
 * Route handlers can use `req.log` / `res.log` for the same request id.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) =>
    req.headers["x-request-id"]?.toString().slice(0, 80) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  customLogLevel: (_req, res, err) => {
    if (err) {
      return "error";
    }
    if (res.statusCode >= 500) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    return "info";
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`,
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.originalUrl || req.url,
      id: req.id,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
