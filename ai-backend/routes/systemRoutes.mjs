import { Router } from "express";
import { createSystemController } from "../controllers/systemController.mjs";

export function createSystemRoutes({ asyncRoute, probeDbHealth }) {
  const router = Router();
  const controller = createSystemController({ probeDbHealth });

  router.get("/", controller.root);
  router.get("/health", controller.health);
  router.get("/health/db", asyncRoute(controller.healthDb));

  return router;
}
