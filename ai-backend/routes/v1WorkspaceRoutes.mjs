import { Router } from "express";
import { createWorkspaceController } from "../controllers/workspaceController.mjs";

export function createV1WorkspaceRoutes(deps) {
  const router = Router();
  const controller = createWorkspaceController(deps);

  router.get("/v1/workspaces", deps.asyncRoute(controller.listWorkspaces));
  router.patch(
    "/v1/workspaces/:workspaceId",
    deps.asyncRoute(controller.patchWorkspace),
  );
  router.post(
    "/v1/workspaces/:workspaceId/folders",
    deps.asyncRoute(controller.createFolder),
  );
  router.get(
    "/v1/workspaces/:workspaceId/folders",
    deps.asyncRoute(controller.listFolders),
  );
  router.patch("/v1/folders/:folderId", deps.asyncRoute(controller.patchFolder));
  router.delete("/v1/folders/:folderId", deps.asyncRoute(controller.deleteFolder));

  return router;
}
