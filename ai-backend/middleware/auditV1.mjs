export function createAuditV1Middleware({ getAuth, pgQuery }) {
  async function logProcessEntry({
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
      await pgQuery(
        `
        INSERT INTO api_process_logs (
          user_id, clerk_user_id, route, http_method, status_code, duration_ms,
          client_ip, user_agent, error_message, details
        )
        VALUES (
          (SELECT id FROM users WHERE clerk_user_id = $1 LIMIT 1),
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
        );
      `,
        [
          clerkUserId,
          route,
          method,
          statusCode,
          durationMs,
          clientIp,
          userAgent?.slice(0, 2000) ?? null,
          errorMessage?.slice(0, 2000) ?? null,
          details == null ? null : JSON.stringify(details, (k, v) => typeof v === 'bigint' ? v.toString() : v),
        ],
      );
    } catch (err) {
      console.error("[audit] logProcessEntry failed", err);
    }
  }

  async function touchUserLastApiByClerk(clerkUserId) {
    if (!clerkUserId || !process.env.NEON_DATABASE_URL) {
      return;
    }
    try {
      await pgQuery(
        `UPDATE users SET last_api_at = NOW() WHERE clerk_user_id = $1`,
        [clerkUserId],
      );
    } catch (err) {
      console.error("[audit] touchUserLastApi failed", err);
    }
  }

  return function auditV1Requests(req, res, next) {
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

        if (clerkUserId && statusCode < 500) {
          await touchUserLastApiByClerk(clerkUserId);
        }
      })();
    };

    res.on("finish", flush);
    res.on("close", flush);
    next();
  };
}
