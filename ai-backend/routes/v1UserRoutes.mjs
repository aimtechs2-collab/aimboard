import { Router } from "express";
import { createUserController } from "../controllers/userController.mjs";

export function createV1UserRoutes(deps) {
  const router = Router();
  const controller = createUserController(deps);

  router.get("/v1/auth/me", deps.asyncRoute(controller.me));
  router.post("/v1/activity", deps.asyncRoute(controller.activity));

  return router;
}
