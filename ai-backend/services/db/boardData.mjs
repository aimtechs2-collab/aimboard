import { gunzipSync, gzipSync } from "node:zlib";

const DEFAULT_SCENE_SOURCE = "https://aimtutor.ai";

export function defaultEmptyScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: DEFAULT_SCENE_SOURCE,
    elements: [],
    appState: {},
    files: {},
  };
}

export function sceneToGzipBuffer(sceneObj) {
  return gzipSync(Buffer.from(JSON.stringify(sceneObj), "utf8"));
}

export function gzipBufferToScene(buf) {
  const raw = gunzipSync(buf).toString("utf8");
  return JSON.parse(raw);
}

export function createOwnershipQueries({ pgQuery }) {
  return {
    async ensureDefaultWorkspace(localUserId) {
      const { rows } = await pgQuery(
        `SELECT id, name, created_at, updated_at FROM workspaces WHERE owner_user_id = $1::bigint`,
        [localUserId],
      );
      if (rows.length) {
        return rows[0];
      }
      const ins = await pgQuery(
        `INSERT INTO workspaces (owner_user_id, name) VALUES ($1::bigint, 'My workspace')
         RETURNING id, name, created_at, updated_at`,
        [localUserId],
      );
      return ins.rows[0];
    },

    async assertWorkspaceOwned(workspaceId, localUserId) {
      if (!/^\d+$/.test(String(workspaceId))) return null;
      const { rows } = await pgQuery(
        `SELECT id, name, created_at, updated_at FROM workspaces WHERE id = $1::bigint AND owner_user_id = $2::bigint`,
        [workspaceId, localUserId],
      );
      return rows[0] ?? null;
    },

    async assertFolderOwned(folderId, localUserId) {
      if (!/^\d+$/.test(String(folderId))) return null;
      const { rows } = await pgQuery(
        `
        SELECT f.id, f.workspace_id, f.name, f.sort_order, f.created_at, f.updated_at
        FROM folders f
        JOIN workspaces w ON w.id = f.workspace_id
        WHERE f.id = $1::bigint AND w.owner_user_id = $2::bigint
        `,
        [folderId, localUserId],
      );
      return rows[0] ?? null;
    },

    async assertBoardOwned(boardId, localUserId) {
      if (!/^\d+$/.test(String(boardId))) return null;
      const { rows } = await pgQuery(
        `
        SELECT b.id, b.folder_id, b.title, b.scene_gzip, b.created_by_user_id, b.created_at, b.updated_at
        FROM boards b
        JOIN folders f ON f.id = b.folder_id
        JOIN workspaces w ON w.id = f.workspace_id
        WHERE b.id = $1::bigint AND w.owner_user_id = $2::bigint
        `,
        [boardId, localUserId],
      );
      return rows[0] ?? null;
    },

    async assertBoardAiSessionOwned(sessionId, boardId, localUserId) {
      if (!/^\d+$/.test(String(sessionId))) return null;
      const { rows } = await pgQuery(
        `
        SELECT s.id, s.board_id, s.user_id, s.title, s.context_messages_json, s.created_at, s.updated_at
        FROM board_ai_chat_sessions s
        WHERE s.id = $1::bigint AND s.board_id = $2::bigint AND s.user_id = $3::bigint
        `,
        [sessionId, boardId, localUserId],
      );
      return rows[0] ?? null;
    },
  };
}
