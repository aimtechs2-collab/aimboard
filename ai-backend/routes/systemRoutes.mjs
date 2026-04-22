import { Router, raw } from "express";
import { createSystemController } from "../controllers/systemController.mjs";

export function createSystemRoutes({
  asyncRoute,
  probeDbHealth,
  pgQuery,
  requireDatabase,
}) {
  const router = Router();
  const controller = createSystemController({ probeDbHealth, pgQuery, requireDatabase });

  router.get("/", controller.root);
  router.get("/health", controller.health);
  router.get("/health/db", asyncRoute(controller.healthDb));
  router.post(
    "/api/v2/post",
    raw({ type: "*/*", limit: "35mb" }),
    asyncRoute(controller.shareCreate),
  );
  router.get("/api/v2/:id", asyncRoute(controller.shareGet));
  router.put(
    "/api/v2/files/:id/:fileId",
    raw({ type: "*/*", limit: "20mb" }),
    asyncRoute(controller.shareFilePut),
  );
  router.get("/api/v2/files/:id/:fileId", asyncRoute(controller.shareFileGet));

  return router;
}
