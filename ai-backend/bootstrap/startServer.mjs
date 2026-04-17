export function startServer({
  ensureSchema,
  monitorDbConnectivity,
  app,
  logger,
  isProduction,
  host,
  port,
  attachRealtimeServer,
  prisma,
  routes,
}) {
  let dbMonitorInterval = null;

  ensureSchema()
    .then(() => {
      void monitorDbConnectivity();
      dbMonitorInterval = setInterval(() => {
        void monitorDbConnectivity();
      }, 15_000);

      const server = app.listen(port, host, () => {
        logger.info(
          {
            env: isProduction ? "production" : "development",
            host,
            port,
          },
          `[aimtutor-ai] listening http://${host}:${port}`,
        );
        logger.debug({ routes }, "registered v1 routes");
      });

      const io = attachRealtimeServer(server);

      const shutdown = (signal) => {
        logger.info({ signal }, "[aimtutor-ai] shutting down");
        if (dbMonitorInterval) {
          clearInterval(dbMonitorInterval);
        }
        io.close();
        server.close(() => {
          prisma.$disconnect().finally(() => process.exit(0));
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
}
