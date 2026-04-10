/**
 * Unsplash image search for tutor visuals.
 * Used by Express chat (OpenAI tools) and the MCP stdio server.
 */

const DEFAULT_MAX = 5;
const UNSPLASH_SEARCH = "https://api.unsplash.com/search/photos";

/** Hosts we allow in returned image URLs after API response. */
function isAllowedImageUrl(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return false;
  }
  try {
    const u = new URL(url);
    return (
      u.hostname === "images.unsplash.com" ||
      u.hostname.endsWith(".unsplash.com")
    );
  } catch {
    return false;
  }
}

/**
 * @param {{ query: string; max?: number }} opts
 * @returns {Promise<Array<{ url: string; alt: string }>>}
 */
export async function searchImages({ query, max = DEFAULT_MAX }) {
  const q = String(query ?? "").trim().slice(0, 200);
  const cap = Math.min(Math.max(1, max), 5);
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key || !q) {
    return [];
  }

  try {
    const url = new URL(UNSPLASH_SEARCH);
    url.searchParams.set("query", q);
    url.searchParams.set("per_page", String(cap));

    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[aimtutor-ai] Unsplash search HTTP ${res.status} for query`);
      }
      return [];
    }

    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const seen = new Set();
    const out = [];

    for (const p of results) {
      const rawUrl =
        p?.urls?.small || p?.urls?.regular || p?.urls?.thumb || "";
      if (!rawUrl || !isAllowedImageUrl(rawUrl)) {
        continue;
      }
      if (seen.has(rawUrl)) {
        continue;
      }
      seen.add(rawUrl);
      const altRaw =
        (typeof p.alt_description === "string" && p.alt_description) ||
        (typeof p.description === "string" && p.description) ||
        q;
      const alt = String(altRaw).replace(/\s+/g, " ").trim().slice(0, 240);
      out.push({ url: rawUrl, alt: alt || "Reference image" });
      if (out.length >= cap) {
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
