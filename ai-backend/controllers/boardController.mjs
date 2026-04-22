function serializeBoardListRow(r, authorLabel) {
  return {
    id: String(r.id),
    folderId: String(r.folder_id),
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    author: authorLabel || null,
  };
}

export function createBoardController(deps) {
  const {
    requireDatabase,
    requireAuthApi,
    upsertUserFromAuth,
    assertFolderOwned,
    assertBoardOwned,
    assertBoardAiSessionOwned,
    defaultEmptyScene,
    sceneToGzipBuffer,
    gzipBufferToScene,
    parseSidebarChatMessagesArray,
    parseContextMessagesJson,
    sanitizeChatImagesArray,
    pgQuery,
    prisma,
    redisCache,
  } = deps;

  const boardsCacheTtlSeconds = Number.parseInt(
    process.env.REDIS_CACHE_TTL_BOARDS_LIST_SECONDS || "",
    10,
  ) || 20;

  function boardsListCacheKey(localUserId, folderId) {
    return `boards:${localUserId}:${folderId}`;
  }

  return {
    async createBoard(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const folderId = req.params.folderId;
      const folder = await assertFolderOwned(folderId, localUserId);
      if (!folder) {
        res.locals.auditError = "folder not found";
        res.status(404).json({ message: "Folder not found" });
        return;
      }
      const titleRaw =
        typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
      const title = titleRaw || "Untitled board";
      const gzip = sceneToGzipBuffer(defaultEmptyScene());
      const { rows } = await pgQuery(
        `INSERT INTO boards (folder_id, title, scene_gzip, created_by_user_id)
         VALUES ($1::bigint, $2, $3, $4::bigint)
         RETURNING id, folder_id, title, created_at, updated_at`,
        [folderId, title, gzip, localUserId],
      );
      await redisCache?.del(boardsListCacheKey(localUserId, folderId));
      res.locals.auditDetails = { kind: "board_create", boardId: rows[0].id };
      res.status(201).json({ board: serializeBoardListRow(rows[0], null) });
    },

    async listBoards(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const folderId = req.params.folderId;
      const folder = await assertFolderOwned(folderId, localUserId);
      if (!folder) {
        res.locals.auditError = "folder not found";
        res.status(404).json({ message: "Folder not found" });
        return;
      }
      const cacheKey = boardsListCacheKey(localUserId, folderId);
      const cached = await redisCache?.getJson(cacheKey);
      if (cached) {
        res.locals.auditDetails = { kind: "boards_list_cache_hit" };
        res.json(cached);
        return;
      }
      const { rows } = await pgQuery(
        `
        SELECT b.id, b.folder_id, b.title, b.created_at, b.updated_at,
          u.name AS author_name, u.email AS author_email
        FROM boards b
        LEFT JOIN users u ON u.id = b.created_by_user_id
        WHERE b.folder_id = $1::bigint
        ORDER BY b.updated_at DESC
        `,
        [folderId],
      );
      const payload = {
        boards: rows.map((r) => serializeBoardListRow(r, r.author_name || r.author_email)),
      };
      await redisCache?.setJson(cacheKey, payload, {
        ttlSeconds: boardsCacheTtlSeconds,
      });
      res.locals.auditDetails = { kind: "boards_list" };
      res.json(payload);
    },

    async getBoard(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      let scene;
      try {
        scene = gzipBufferToScene(board.scene_gzip);
      } catch {
        res.locals.auditError = "corrupt scene";
        res.status(500).json({ message: "Board data could not be read" });
        return;
      }
      res.locals.auditDetails = { kind: "board_get" };
      res.json({
        board: {
          id: String(board.id),
          folderId: String(board.folder_id),
          title: board.title,
          createdAt: board.created_at,
          updatedAt: board.updated_at,
        },
        scene,
      });
    },

    async putBoard(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const scene = req.body?.scene;
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
        res.locals.auditError = "invalid scene";
        res.status(400).json({ message: "body.scene must be an object" });
        return;
      }
      const expected =
        typeof req.body?.expectedUpdatedAt === "string" ? req.body.expectedUpdatedAt : null;
      if (expected) {
        const prevIso = new Date(board.updated_at).toISOString();
        if (prevIso !== expected) {
          res.locals.auditError = "version conflict";
          res.status(409).json({
            message: "Board was modified elsewhere. Reload and try again.",
            currentUpdatedAt: prevIso,
          });
          return;
        }
      }
      let gzip;
      try {
        gzip = sceneToGzipBuffer(scene);
      } catch {
        res.locals.auditError = "scene serialize failed";
        res.status(400).json({ message: "Could not store scene" });
        return;
      }
      const maxBytes = parseInt(process.env.BOARD_SCENE_MAX_GZIP_BYTES || "12582912", 10);
      if (gzip.length > maxBytes) {
        res.locals.auditError = "scene too large";
        res.status(413).json({ message: "Board is too large to save" });
        return;
      }
      const titleUpd =
        typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : null;
      const { rows } = await pgQuery(
        `
        UPDATE boards SET
          scene_gzip = $2,
          title = COALESCE($3, title),
          updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING id, folder_id, title, created_at, updated_at
        `,
        [boardId, gzip, titleUpd],
      );
      await redisCache?.del(boardsListCacheKey(localUserId, rows[0].folder_id));
      res.locals.auditDetails = { kind: "board_put" };
      res.json({
        board: {
          id: String(rows[0].id),
          folderId: String(rows[0].folder_id),
          title: rows[0].title,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        },
      });
    },

    async patchBoard(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const title =
        typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : null;
      if (!title) {
        res.status(400).json({ message: "title is required" });
        return;
      }
      const { rows } = await pgQuery(
        `UPDATE boards SET title = $2, updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id, folder_id, title, created_at, updated_at`,
        [boardId, title],
      );
      await redisCache?.del(boardsListCacheKey(localUserId, rows[0].folder_id));
      res.locals.auditDetails = { kind: "board_patch" };
      res.json({ board: serializeBoardListRow(rows[0], null) });
    },

    async deleteBoard(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      await pgQuery(`DELETE FROM boards WHERE id = $1::bigint`, [boardId]);
      await redisCache?.del(boardsListCacheKey(localUserId, board.folder_id));
      res.locals.auditDetails = { kind: "board_delete", boardId };
      res.status(204).end();
    },

    async listBoardChats(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const { rows } = await pgQuery(
        `
        SELECT s.id, s.title, s.created_at, s.updated_at,
          (SELECT COUNT(*)::int FROM board_ai_chat_messages m WHERE m.session_id = s.id) AS message_count
        FROM board_ai_chat_sessions s
        WHERE s.board_id = $1::bigint AND s.user_id = $2::bigint
        ORDER BY s.updated_at DESC
        LIMIT 100
        `,
        [boardId, localUserId],
      );
      res.locals.auditDetails = { kind: "board_ai_chats_list" };
      res.json({
        sessions: rows.map((r) => ({
          id: String(r.id),
          title: r.title,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          messageCount:
            typeof r.message_count === "bigint"
              ? Number(r.message_count)
              : Number(r.message_count) || 0,
        })),
      });
    },

    async getBoardChat(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const sessionId = req.params.sessionId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
      if (!session) {
        res.locals.auditError = "chat session not found";
        res.status(404).json({ message: "Chat session not found" });
        return;
      }
      let contextMessages = [];
      try {
        const raw = session.context_messages_json;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const cm = parseContextMessagesJson(parsed);
        contextMessages = cm == null ? [] : cm;
      } catch {
        contextMessages = [];
      }
      const msgRows = await pgQuery(
        `
        SELECT role, content, images_json FROM board_ai_chat_messages
        WHERE session_id = $1::bigint
        ORDER BY position ASC
        `,
        [sessionId],
      );
      res.locals.auditDetails = { kind: "board_ai_chat_get" };
      res.json({
        session: {
          id: String(session.id),
          title: session.title,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
        contextMessages,
        messages: msgRows.rows.map((r) => {
          const msg = { role: r.role, content: r.content };
          if (r.role === "assistant" && r.images_json != null) {
            try {
              const raw = typeof r.images_json === "string" ? JSON.parse(r.images_json) : r.images_json;
              const imgs = sanitizeChatImagesArray(raw);
              if (imgs?.length) {
                msg.images = imgs;
              }
            } catch {
              // ignore corrupt json
            }
          }
          return msg;
        }),
      });
    },

    async createBoardChat(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const titleRaw =
        typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) : "";
      const title = titleRaw || "Chat";
      const { rows } = await pgQuery(
        `
        INSERT INTO board_ai_chat_sessions (board_id, user_id, title, context_messages_json)
        VALUES ($1::bigint, $2::bigint, $3, '[]'::jsonb)
        RETURNING id, title, created_at, updated_at
        `,
        [boardId, localUserId, title],
      );
      const r = rows[0];
      res.locals.auditDetails = { kind: "board_ai_chat_create" };
      res.status(201).json({
        session: {
          id: String(r.id),
          title: r.title,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          messageCount: 0,
        },
      });
    },

    async putBoardChat(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const sessionId = req.params.sessionId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
      if (!session) {
        res.locals.auditError = "chat session not found";
        res.status(404).json({ message: "Chat session not found" });
        return;
      }
      const messages = parseSidebarChatMessagesArray(req.body?.messages);
      if (messages == null) {
        res.locals.auditError = "invalid messages";
        res.status(400).json({ message: "body.messages must be an array of {role, content}" });
        return;
      }
      const contextMessages = parseContextMessagesJson(req.body?.contextMessages);
      if (contextMessages == null) {
        res.locals.auditError = "invalid contextMessages";
        res.status(400).json({
          message: "body.contextMessages must be an array of {role, content}",
        });
        return;
      }
      const titleUpd =
        typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 200) || null : null;
      let ctxJson;
      try {
        ctxJson = JSON.stringify(contextMessages);
        if (ctxJson.length > 500_000) {
          throw new Error("context too large");
        }
      } catch {
        res.locals.auditError = "context serialize failed";
        res.status(400).json({ message: "contextMessages too large" });
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `DELETE FROM board_ai_chat_messages WHERE session_id = $1::bigint`,
          sessionId,
        );
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          const imagesPayload =
            m.role === "assistant" && m.images?.length ? JSON.stringify(m.images) : null;
          await tx.$executeRawUnsafe(
            `
            INSERT INTO board_ai_chat_messages (session_id, position, role, content, images_json)
            VALUES ($1::bigint, $2, $3, $4, $5::jsonb)
            `,
            sessionId,
            i,
            m.role,
            m.content,
            imagesPayload,
          );
        }
        await tx.$executeRawUnsafe(
          `
          UPDATE board_ai_chat_sessions
          SET
            title = COALESCE($2, title),
            context_messages_json = $3::jsonb,
            updated_at = NOW()
          WHERE id = $1::bigint
          `,
          sessionId,
          titleUpd,
          ctxJson,
        );
      });
      const { rows } = await pgQuery(
        `SELECT id, title, created_at, updated_at FROM board_ai_chat_sessions WHERE id = $1::bigint`,
        [sessionId],
      );
      const r = rows[0];
      const cnt = await pgQuery(
        `SELECT COUNT(*)::int AS c FROM board_ai_chat_messages WHERE session_id = $1::bigint`,
        [sessionId],
      );
      res.locals.auditDetails = { kind: "board_ai_chat_put" };
      res.json({
        session: {
          id: String(r.id),
          title: r.title,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          messageCount: cnt.rows[0]?.c ?? 0,
        },
      });
    },

    async deleteBoardChat(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const boardId = req.params.boardId;
      const sessionId = req.params.sessionId;
      const board = await assertBoardOwned(boardId, localUserId);
      if (!board) {
        res.locals.auditError = "board not found";
        res.status(404).json({ message: "Board not found" });
        return;
      }
      const session = await assertBoardAiSessionOwned(sessionId, boardId, localUserId);
      if (!session) {
        res.locals.auditError = "chat session not found";
        res.status(404).json({ message: "Chat session not found" });
        return;
      }
      await pgQuery(`DELETE FROM board_ai_chat_sessions WHERE id = $1::bigint`, [sessionId]);
      res.locals.auditDetails = { kind: "board_ai_chat_delete", sessionId };
      res.status(204).end();
    },
  };
}
