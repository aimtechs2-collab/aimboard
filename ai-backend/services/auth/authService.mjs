export function parseActivityEvents(body) {
  const raw = body?.events;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    return null;
  }
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      return null;
    }
    const action = typeof e.action === "string" ? e.action.trim().slice(0, 200) : "";
    if (!action) {
      return null;
    }
    const category =
      typeof e.category === "string" ? e.category.trim().slice(0, 100) : null;
    let metadataJson = null;
    if (e.metadata != null) {
      if (typeof e.metadata !== "object" || Array.isArray(e.metadata)) {
        return null;
      }
      try {
        const s = JSON.stringify(e.metadata);
        metadataJson = s.length > 12_000 ? JSON.stringify({ _truncated: true }) : s;
      } catch {
        return null;
      }
    }
    out.push({ action, category, metadataJson });
  }
  return out.length ? out : null;
}

export function createAuthHelpers({ getAuth, pgQuery }) {
  function requireAuthApi(req, res) {
    const auth = getAuth(req);
    if (!auth?.userId) {
      const hasBearer =
        typeof req.headers.authorization === "string" &&
        req.headers.authorization.startsWith("Bearer ");
      res.locals.auditError = hasBearer
        ? "Unauthorized (Clerk rejected session JWT — check CLERK_SECRET_KEY matches VITE_CLERK_PUBLISHABLE_KEY instance)"
        : "Unauthorized (no Authorization: Bearer token — client must call getToken() and send it)";
      res.status(401).json({ message: "Unauthorized" });
      return null;
    }
    return auth;
  }

  async function fetchClerkUserName(clerkUserId) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;
    try {
      const resp = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return (
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
        data.username ||
        data.email_addresses?.[0]?.email_address ||
        null
      );
    } catch {
      return null;
    }
  }

  async function upsertUserFromAuth(auth) {
    const email =
      auth.sessionClaims?.email ||
      auth.sessionClaims?.email_address ||
      auth.sessionClaims?.["email"];
    let name =
      auth.sessionClaims?.full_name ||
      [auth.sessionClaims?.first_name, auth.sessionClaims?.last_name]
        .filter(Boolean)
        .join(" ") ||
      null;
    const avatarUrl = auth.sessionClaims?.image_url || null;
    if (!name) {
      name = await fetchClerkUserName(auth.userId);
    }
    const { rows } = await pgQuery(
      `
        INSERT INTO users (clerk_user_id, email, name, avatar_url, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (clerk_user_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          name = COALESCE(EXCLUDED.name, users.name),
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
        RETURNING id;
      `,
      [auth.userId, email || null, name, avatarUrl],
    );
    return rows[0].id;
  }

  return { requireAuthApi, upsertUserFromAuth };
}
