import { Router } from "express";
import { createBoardController } from "../controllers/boardController.mjs";

export function createV1BoardRoutes(deps) {
  const router = Router();
  const controller = createBoardController(deps);

  router.post(
    "/v1/folders/:folderId/boards",
    deps.asyncRoute(controller.createBoard),
  );
  router.get(
    "/v1/folders/:folderId/boards",
    deps.asyncRoute(controller.listBoards),
  );
  router.get("/v1/boards/:boardId", deps.asyncRoute(controller.getBoard));
  router.put(
    "/v1/boards/:boardId",
    deps.boardPutLimiter,
    deps.asyncRoute(controller.putBoard),
  );
  router.patch("/v1/boards/:boardId", deps.asyncRoute(controller.patchBoard));
  router.delete("/v1/boards/:boardId", deps.asyncRoute(controller.deleteBoard));

  router.get(
    "/v1/boards/:boardId/ai-chats",
    deps.asyncRoute(controller.listBoardChats),
  );
  router.get(
    "/v1/boards/:boardId/ai-chats/:sessionId",
    deps.asyncRoute(controller.getBoardChat),
  );
  router.post(
    "/v1/boards/:boardId/ai-chats",
    deps.asyncRoute(controller.createBoardChat),
  );
  router.put(
    "/v1/boards/:boardId/ai-chats/:sessionId",
    deps.asyncRoute(controller.putBoardChat),
  );
  router.delete(
    "/v1/boards/:boardId/ai-chats/:sessionId",
    deps.asyncRoute(controller.deleteBoardChat),
  );

  return router;
}
