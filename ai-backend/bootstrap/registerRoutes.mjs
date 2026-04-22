import { createSystemRoutes } from "../routes/systemRoutes.mjs";
import { createV1AiRoutes } from "../routes/v1AiRoutes.mjs";
import { createV1BoardRoutes } from "../routes/v1BoardRoutes.mjs";
import { createV1UserRoutes } from "../routes/v1UserRoutes.mjs";
import { createV1WorkspaceRoutes } from "../routes/v1WorkspaceRoutes.mjs";

export const routeManifest = [
  "GET    /health",
  "GET    /health/db",
  "GET    /v1/auth/me",
  "POST   /v1/activity",
  "GET    /v1/workspaces",
  "PATCH  /v1/workspaces/:workspaceId",
  "POST   /v1/workspaces/:workspaceId/folders",
  "GET    /v1/workspaces/:workspaceId/folders",
  "PATCH  /v1/folders/:folderId",
  "DELETE /v1/folders/:folderId",
  "POST   /v1/folders/:folderId/boards",
  "GET    /v1/folders/:folderId/boards",
  "GET    /v1/boards/:boardId",
  "PUT    /v1/boards/:boardId",
  "PATCH  /v1/boards/:boardId",
  "DELETE /v1/boards/:boardId",
  "GET    /v1/boards/:boardId/ai-chats",
  "GET    /v1/boards/:boardId/ai-chats/:sessionId",
  "POST   /v1/boards/:boardId/ai-chats",
  "PUT    /v1/boards/:boardId/ai-chats/:sessionId",
  "DELETE /v1/boards/:boardId/ai-chats/:sessionId",
  "GET    /v1/ai/ollama/models",
  "POST   /v1/ai/text-to-diagram/chat-streaming",
  "POST   /v1/ai/sidebar-chat-streaming",
  "POST   /v1/ai/sidebar-chat",
  "POST   /v1/ai/diagram-to-code/generate",
];

export function registerRoutes({
  app,
  asyncRoute,
  probeDbHealth,
  boardPutLimiter,
  requireDatabase,
  appDeps,
  aiDeps,
}) {
  app.use(createSystemRoutes({ asyncRoute, probeDbHealth }));

  app.use(
    createV1UserRoutes({
      asyncRoute,
      requireDatabase,
      requireAuthApi: appDeps.requireAuthApi,
      upsertUserFromAuth: appDeps.upsertUserFromAuth,
      parseActivityEvents: appDeps.parseActivityEvents,
      pgQuery: appDeps.pgQuery,
    }),
  );

  app.use(
    createV1WorkspaceRoutes({
      asyncRoute,
      requireDatabase,
      requireAuthApi: appDeps.requireAuthApi,
      upsertUserFromAuth: appDeps.upsertUserFromAuth,
      ensureDefaultWorkspace: appDeps.ensureDefaultWorkspace,
      assertWorkspaceOwned: appDeps.assertWorkspaceOwned,
      assertFolderOwned: appDeps.assertFolderOwned,
      pgQuery: appDeps.pgQuery,
      prisma: appDeps.prisma,
      redisCache: appDeps.redisCache,
    }),
  );

  app.use(
    createV1BoardRoutes({
      asyncRoute,
      boardPutLimiter,
      requireDatabase,
      requireAuthApi: appDeps.requireAuthApi,
      upsertUserFromAuth: appDeps.upsertUserFromAuth,
      assertFolderOwned: appDeps.assertFolderOwned,
      assertBoardOwned: appDeps.assertBoardOwned,
      assertBoardAiSessionOwned: appDeps.assertBoardAiSessionOwned,
      defaultEmptyScene: appDeps.defaultEmptyScene,
      sceneToGzipBuffer: appDeps.sceneToGzipBuffer,
      gzipBufferToScene: appDeps.gzipBufferToScene,
      parseSidebarChatMessagesArray: appDeps.parseSidebarChatMessagesArray,
      parseContextMessagesJson: appDeps.parseContextMessagesJson,
      sanitizeChatImagesArray: appDeps.sanitizeChatImagesArray,
      pgQuery: appDeps.pgQuery,
      prisma: appDeps.prisma,
      redisCache: appDeps.redisCache,
    }),
  );

  app.use(
    createV1AiRoutes({
      asyncRoute,
      requireDatabase,
      requireAuthApi: appDeps.requireAuthApi,
      requireAiProvider: aiDeps.requireAiProvider,
      upsertUserFromAuth: appDeps.upsertUserFromAuth,
      parseAiProvider: aiDeps.parseAiProvider,
      parseAiModel: aiDeps.parseAiModel,
      createOpenAIClient: aiDeps.createOpenAIClient,
      ollamaChatStreaming: aiDeps.ollamaChatStreaming,
      ollamaChatNonStreaming: aiDeps.ollamaChatNonStreaming,
      OLLAMA_BASE_URL: aiDeps.ollamaBaseUrl,
      OLLAMA_TIMEOUT_MS: aiDeps.ollamaTimeoutMs,
      MODEL: aiDeps.model,
      VISION_MODEL: aiDeps.visionModel,
      MERMAID_SYSTEM: aiDeps.mermaidSystem,
      logUsage: aiDeps.logUsage,
      publicErrorMessage: aiDeps.publicErrorMessage,
      parseSidebarChatMode: aiDeps.parseSidebarChatMode,
      buildSidebarOpenAIMessages: aiDeps.buildSidebarOpenAIMessages,
      runSidebarImagePipeline: aiDeps.runSidebarImagePipeline,
      SIDEBAR_IMAGES_ONLY_MAX_REFERENCE_IMAGES:
        aiDeps.sidebarImagesOnlyMaxReferenceImages,
      SIDEBAR_TOPIC_PLUS_IMAGES_MAX_REFERENCE_IMAGES:
        aiDeps.sidebarTopicPlusImagesMaxReferenceImages,
    }),
  );
}
