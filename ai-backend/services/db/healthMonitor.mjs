export function createDbHealthMonitor({ prisma, logger }) {
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

  return { probeDbHealth, monitorDbConnectivity };
}
