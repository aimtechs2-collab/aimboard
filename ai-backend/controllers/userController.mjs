export function createUserController({
  requireDatabase,
  requireAuthApi,
  upsertUserFromAuth,
  parseActivityEvents,
  pgQuery,
}) {
  return {
    async me(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const userId = await upsertUserFromAuth(auth);
      const { rows } = await pgQuery(
        `SELECT id, clerk_user_id, email, name, avatar_url, created_at, updated_at, last_api_at FROM users WHERE id = $1::bigint`,
        [userId],
      );
      res.locals.auditDetails = { kind: "auth_me" };
      res.json({ user: rows[0] });
    },

    async activity(req, res) {
      if (!requireDatabase(res)) {
        return;
      }
      const auth = requireAuthApi(req, res);
      if (!auth) {
        return;
      }
      const events = parseActivityEvents(req.body);
      if (!events) {
        res.locals.auditError = "body.events must be a non-empty array (max 50)";
        res.status(400).json({
          message:
            "body.events must be a non-empty array of { action, category?, metadata? }",
        });
        return;
      }
      const localUserId = await upsertUserFromAuth(auth);
      const placeholders = [];
      const params = [];
      let n = 1;
      for (const ev of events) {
        const u = n;
        placeholders.push(
          `($${u}::bigint, $${u + 1}, $${u + 2}, $${u + 3}, $${u + 4}::jsonb)`,
        );
        n += 5;
        params.push(
          localUserId,
          auth.userId,
          ev.action,
          ev.category,
          ev.metadataJson,
        );
      }
      await pgQuery(
        `INSERT INTO user_activity_events (user_id, clerk_user_id, action, category, metadata) VALUES ${placeholders.join(", ")}`,
        params,
      );
      res.locals.auditDetails = {
        kind: "user_activity",
        count: events.length,
      };
      res.status(204).end();
    },
  };
}
