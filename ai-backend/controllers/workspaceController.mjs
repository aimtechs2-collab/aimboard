function serializeFolderRow(r) {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: r.name,
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Prisma raw rows often use bigint for counts; JSON.stringify cannot serialize BigInt. */
function countField(value) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function createWorkspaceController({
  requireDatabase,
  requireAuthApi,
  upsertUserFromAuth,
  ensureDefaultWorkspace,
  assertWorkspaceOwned,
  assertFolderOwned,
  pgQuery,
  redisCache,
}) {
  const foldersCacheTtlSeconds = Number.parseInt(
    process.env.REDIS_CACHE_TTL_FOLDERS_LIST_SECONDS || "",
    10,
  ) || 25;

  function foldersCacheKey(localUserId, workspaceId) {
    return `folders:${localUserId}:${workspaceId}`;
  }

  return {
    async listWorkspaces(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const row = await ensureDefaultWorkspace(localUserId);
      res.locals.auditDetails = { kind: "workspaces_list" };
      res.json({
        workspaces: [
          {
            id: String(row.id),
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        ],
      });
    },

    async patchWorkspace(req, res) {
      if (!requireDatabase(res)) return;
      const auth = requireAuthApi(req, res);
      if (!auth) return;
      const localUserId = await upsertUserFromAuth(auth);
      const workspaceId = req.params.workspaceId;
      const ws = await assertWorkspaceOwned(workspaceId, localUserId);
      if (!ws) {
        res.locals.auditError = "workspace not found";
        res.status(404).json({ message: "Workspace not found" });
        return;
      }
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : null;
      if (!name) {
        res.status(400).json({ message: "name is required" });
        return;
      }
      const { rows } = await pgQuery(
        `UPDATE workspaces SET name = $2, updated_at = NOW()
         WHERE id = $1::bigint
         RETURNING id, name, created_at, updated_at`,
        [workspaceId, name],
      );
      res.locals.auditDetails = { kind: "workspace_patch" };
      res.json({
        workspace: {
          id: String(rows[0].id),
          name: rows[0].name,
          createdAt: rows[0].created_at,
          updatedAt: rows[0].updated_at,
        },
      });
    },

    async createFolder(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const workspaceId = req.params.workspaceId;
      const ws = await assertWorkspaceOwned(workspaceId, localUserId);
      if (!ws) {
        res.locals.auditError = "workspace not found";
        res.status(404).json({ message: "Workspace not found" });
        return;
      }
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
      if (!name) {
        res.locals.auditError = "folder name required";
        res.status(400).json({ message: "name is required" });
        return;
      }
      const { rows } = await pgQuery(
        `INSERT INTO folders (workspace_id, name) VALUES ($1::bigint, $2)
         RETURNING id, workspace_id, name, sort_order, created_at, updated_at`,
        [workspaceId, name],
      );
      await redisCache?.del(foldersCacheKey(localUserId, workspaceId));
      res.locals.auditDetails = { kind: "folder_create", folderId: rows[0].id };
      res.status(201).json({ folder: serializeFolderRow(rows[0]) });
    },

    async listFolders(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const workspaceId = req.params.workspaceId;
      const ws = await assertWorkspaceOwned(workspaceId, localUserId);
      if (!ws) {
        res.locals.auditError = "workspace not found";
        res.status(404).json({ message: "Workspace not found" });
        return;
      }
      const cacheKey = foldersCacheKey(localUserId, workspaceId);
      const cached = await redisCache?.getJson(cacheKey);
      if (cached) {
        res.locals.auditDetails = { kind: "folders_list_cache_hit" };
        res.json(cached);
        return;
      }
      const { rows } = await pgQuery(
        `
        SELECT f.id, f.workspace_id, f.name, f.sort_order, f.created_at, f.updated_at,
          (SELECT COUNT(*)::int FROM boards b WHERE b.folder_id = f.id) AS board_count
        FROM folders f
        WHERE f.workspace_id = $1::bigint
        ORDER BY f.sort_order ASC, f.created_at ASC
        `,
        [workspaceId],
      );
      const payload = {
        folders: rows.map((r) => ({
          ...serializeFolderRow(r),
          boardCount: countField(r.board_count),
        })),
      };
      await redisCache?.setJson(cacheKey, payload, {
        ttlSeconds: foldersCacheTtlSeconds,
      });
      res.locals.auditDetails = { kind: "folders_list" };
      res.json(payload);
    },

    async patchFolder(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const folderId = req.params.folderId;
      const folder = await assertFolderOwned(folderId, localUserId);
      if (!folder) {
        res.locals.auditError = "folder not found";
        res.status(404).json({ message: "Folder not found" });
        return;
      }
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : null;
      const sortOrder =
        typeof req.body?.sortOrder === "number" && Number.isFinite(req.body.sortOrder)
          ? Math.trunc(req.body.sortOrder)
          : null;
      if (!name && sortOrder === null) {
        res.status(400).json({ message: "Provide name and/or sortOrder" });
        return;
      }
      const { rows } = await pgQuery(
        `
        UPDATE folders SET
          name = COALESCE($2, name),
          sort_order = COALESCE($3, sort_order),
          updated_at = NOW()
        WHERE id = $1::bigint
        RETURNING id, workspace_id, name, sort_order, created_at, updated_at
        `,
        [folderId, name, sortOrder],
      );
      await redisCache?.del(foldersCacheKey(localUserId, rows[0].workspace_id));
      res.locals.auditDetails = { kind: "folder_patch" };
      res.json({ folder: serializeFolderRow(rows[0]) });
    },

    async deleteFolder(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const folderId = req.params.folderId;
      const folder = await assertFolderOwned(folderId, localUserId);
      if (!folder) {
        res.locals.auditError = "folder not found";
        res.status(404).json({ message: "Folder not found" });
        return;
      }
      await pgQuery(`DELETE FROM folders WHERE id = $1::bigint`, [folderId]);
      await redisCache?.del(foldersCacheKey(localUserId, folder.workspace_id));
      res.locals.auditDetails = { kind: "folder_delete" };
      res.status(204).end();
    },
  };
}
