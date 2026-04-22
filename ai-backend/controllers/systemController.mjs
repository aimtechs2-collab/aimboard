import crypto from "node:crypto";

export function createSystemController({ probeDbHealth, pgQuery, requireDatabase }) {
  const makeShareId = () => crypto.randomBytes(10).toString("hex");
  const isSafeId = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{6,128}$/.test(v);

  const getRawBodyBuffer = (req) => {
    if (Buffer.isBuffer(req.body)) {
      return req.body;
    }
    if (req.body instanceof Uint8Array) {
      return Buffer.from(req.body);
    }
    return null;
  };

  return {
    root(_req, res) {
      res.json({ message: "Board Backend Running" });
    },
    health(_req, res) {
      res.json({ ok: true, service: "aimtutor-ai-backend" });
    },
    async healthDb(_req, res) {
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
    },
    async shareCreate(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const payload = getRawBodyBuffer(req);
      if (!payload || payload.length === 0) {
        res.status(400).json({ error_class: "InvalidRequestError" });
        return;
      }
      const max = 25 * 1024 * 1024;
      if (payload.length > max) {
        res.status(413).json({ error_class: "RequestTooLargeError" });
        return;
      }
      const id = makeShareId();
      await pgQuery(
        `INSERT INTO share_links (id, payload) VALUES ($1, $2)`,
        [id, payload],
      );
      res.status(201).json({ id });
    },
    async shareGet(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const id = req.params.id;
      if (!isSafeId(id)) {
        res.status(400).json({ message: "Invalid share id" });
        return;
      }
      const { rows } = await pgQuery(
        `SELECT payload FROM share_links WHERE id = $1 LIMIT 1`,
        [id],
      );
      const payload = rows[0]?.payload ?? null;
      if (!payload) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    },
    async shareFilePut(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const id = req.params.id;
      const fileId = req.params.fileId;
      if (!isSafeId(id) || !isSafeId(fileId)) {
        res.status(400).json({ message: "Invalid id" });
        return;
      }
      const payload = getRawBodyBuffer(req);
      if (!payload || payload.length === 0) {
        res.status(400).json({ message: "Empty payload" });
        return;
      }
      const max = 15 * 1024 * 1024;
      if (payload.length > max) {
        res.status(413).json({ message: "File too large" });
        return;
      }
      await pgQuery(
        `
        INSERT INTO share_link_files (share_id, file_id, payload)
        VALUES ($1, $2, $3)
        ON CONFLICT (share_id, file_id)
        DO UPDATE SET payload = EXCLUDED.payload, created_at = NOW()
        `,
        [id, fileId, payload],
      );
      res.status(204).end();
    },
    async shareFileGet(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const id = req.params.id;
      const fileId = req.params.fileId;
      if (!isSafeId(id) || !isSafeId(fileId)) {
        res.status(400).json({ message: "Invalid id" });
        return;
      }
      const { rows } = await pgQuery(
        `SELECT payload FROM share_link_files WHERE share_id = $1 AND file_id = $2 LIMIT 1`,
        [id, fileId],
      );
      const payload = rows[0]?.payload ?? null;
      if (!payload) {
        res.status(404).json({ message: "Not found" });
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    },
  };
}
