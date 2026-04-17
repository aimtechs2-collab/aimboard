export function createMessageParsers({ isAllowedChatImageUrl }) {
  function sanitizeChatImagesArray(raw) {
    if (raw == null) {
      return undefined;
    }
    if (!Array.isArray(raw) || raw.length > 4) {
      return undefined;
    }
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const url = String(item.url ?? "").trim();
      const alt = String(item.alt ?? "Image").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!isAllowedChatImageUrl(url) || seen.has(url)) {
        continue;
      }
      seen.add(url);
      out.push({ url, alt: alt || "Image" });
    }
    return out.length ? out : undefined;
  }

  function parseSidebarChatMessagesArray(raw) {
    if (!Array.isArray(raw)) {
      return null;
    }
    if (raw.length > 400) {
      return null;
    }
    const out = [];
    for (const m of raw) {
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        return null;
      }
      const role =
        m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
      if (!role) {
        return null;
      }
      const row = {
        role,
        content: String(m.content ?? "").slice(0, 12000),
      };
      if (role === "assistant") {
        const imgs = sanitizeChatImagesArray(m.images);
        if (imgs?.length) {
          row.images = imgs;
        }
      }
      out.push(row);
    }
    return out;
  }

  function parseContextMessagesJson(raw) {
    if (raw == null) {
      return [];
    }
    if (!Array.isArray(raw) || raw.length > 200) {
      return null;
    }
    const out = [];
    for (const m of raw) {
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        return null;
      }
      const role =
        m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
      if (!role) {
        return null;
      }
      out.push({
        role,
        content: String(m.content ?? "").slice(0, 12000),
      });
    }
    return out;
  }

  return {
    sanitizeChatImagesArray,
    parseSidebarChatMessagesArray,
    parseContextMessagesJson,
  };
}
