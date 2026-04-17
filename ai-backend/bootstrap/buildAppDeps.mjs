import { getAuth } from "@clerk/express";
import { createAuthHelpers, parseActivityEvents } from "../services/auth/authService.mjs";
import { createMessageParsers } from "../services/chat/messageParsers.mjs";
import { createOwnershipQueries } from "../services/db/boardData.mjs";

export function buildAppDeps({
  pgQuery,
  isAllowedChatImageUrl,
}) {
  const {
    ensureDefaultWorkspace,
    assertWorkspaceOwned,
    assertFolderOwned,
    assertBoardOwned,
    assertBoardAiSessionOwned,
  } = createOwnershipQueries({ pgQuery });
  const {
    sanitizeChatImagesArray,
    parseSidebarChatMessagesArray,
    parseContextMessagesJson,
  } = createMessageParsers({ isAllowedChatImageUrl });
  const { requireAuthApi, upsertUserFromAuth } = createAuthHelpers({
    getAuth,
    pgQuery,
  });

  return {
    ensureDefaultWorkspace,
    assertWorkspaceOwned,
    assertFolderOwned,
    assertBoardOwned,
    assertBoardAiSessionOwned,
    sanitizeChatImagesArray,
    parseSidebarChatMessagesArray,
    parseContextMessagesJson,
    requireAuthApi,
    upsertUserFromAuth,
    parseActivityEvents,
  };
}
