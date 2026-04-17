import { Router } from "express";
import { createAiController } from "../controllers/aiController.mjs";

export function createV1AiRoutes(deps) {
  const router = Router();
  const controller = createAiController(deps);

  router.get(
    "/v1/ai/ollama/models",
    deps.asyncRoute(controller.listOllamaModels),
  );
  router.post(
    "/v1/ai/text-to-diagram/chat-streaming",
    deps.asyncRoute(controller.textToDiagramStreaming),
  );
  router.post(
    "/v1/ai/sidebar-chat-streaming",
    deps.asyncRoute(controller.sidebarChatStreaming),
  );
  router.post("/v1/ai/sidebar-chat", deps.asyncRoute(controller.sidebarChat));
  router.post(
    "/v1/ai/diagram-to-code/generate",
    deps.asyncRoute(controller.diagramToCode),
  );

  return router;
}
