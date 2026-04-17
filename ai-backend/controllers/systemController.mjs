export function createSystemController({ probeDbHealth }) {
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
  };
}
