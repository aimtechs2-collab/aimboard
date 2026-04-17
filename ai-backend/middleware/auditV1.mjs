export function createAuditV1Middleware({ getAuth, pgQuery }) {
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
      await pgQuery(
        `
        INSERT INTO api_process_logs (
          user_id, clerk_user_id, route, http_method, status_code, duration_ms,
          client_ip, user_agent, error_message, details
        )
        VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);
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
      await pgQuery(`UPDATE users SET last_api_at = NOW() WHERE id = $1::bigint`, [userId]);
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
        let localUserId = null;
        if (clerkUserId) {
          try {
            const r = await pgQuery(
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
  };
}
