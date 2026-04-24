/**
 * Image search for tutor reference visuals via SerpAPI (Google Images).
 * Used by Express sidebar chat and MCP fetch_images/search_images.
 */

import { templateFallbackQueries } from "./imageQueryOpenAI.mjs";
import { logger } from "./logger.mjs";

const imgLog = logger.child({ module: "imageSearch" });

const SERPAPI_ENDPOINT =
  process.env.SERPAPI_ENDPOINT?.trim() || "https://serpapi.com/search.json";
const CACHE_TTL_MS = 3_600_000;
const cache = new Map();

/** @type {Map<string, { expiresAt: number; items: Array<{ url: string; alt: string }> }>} */

function isPrivateOrLocalHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) {
    return true;
  }
  if (h === "::1") {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = h.match(ipv4);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) {
      return true;
    }
    if (a === 127) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a URL is acceptable to persist/serve as a chat thumbnail (HTTPS, no obvious SSRF).
 * @param {string} url
 */
export function isAllowedChatImageUrl(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return false;
  }
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") {
      return false;
    }
    if (isPrivateOrLocalHost(u.hostname)) {
      return false;
    }
    if (u.username || u.password) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeImageLink(link) {
  const s = String(link || "").trim();
  if (s.startsWith("http://")) {
    return `https://${s.slice(7)}`;
  }
  return s;
}

/** Aggressive junk filter; skip for second pass if everything was dropped. */
function shouldFilterResultStrict(link, title, snippet) {
  const blob = `${link} ${title} ${snippet}`.toLowerCase();
  if (
    /favicon|fav-icon|apple-touch-icon|\.ico(\?|$)|brand-asset|\/sprites?\//i.test(
      blob,
    )
  ) {
    return true;
  }
  if (/\.svg(\?|#|$)/i.test(link)) {
    return true;
  }
  const norm = normalizeImageLink(link);
  if (!norm.startsWith("https://")) {
    return true;
  }
  return !isAllowedChatImageUrl(norm);
}

function shouldFilterResultMinimal(link, _title, _snippet) {
  const norm = normalizeImageLink(link);
  if (!norm.startsWith("https://")) {
    return true;
  }
  if (/\.svg(\?|#|$)/i.test(norm)) {
    return true;
  }
  return !isAllowedChatImageUrl(norm);
}

/**
 * @param {string} query
 * @param {number} num
 * @returns {Promise<Array<{ link: string; title: string; snippet: string }>>}
 */
async function searchSerpImagesOneQuery(query, num) {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key || !query) {
    return [];
  }

  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));

    const errMsg =
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
          (Array.isArray(data.error)
            ? data.error.map((e) => e?.message).filter(Boolean).join("; ")
            : null);
    if (errMsg) {
      imgLog.warn(
        { status: res.status, query: query.slice(0, 120) },
        String(errMsg).slice(0, 500),
      );
      return [];
    }

    if (!res.ok) {
      imgLog.warn(
        { status: res.status, query: query.slice(0, 120) },
        "SerpAPI HTTP error",
      );
      return [];
    }

    const raw = Array.isArray(data.images_results) ? data.images_results : [];
    const cap = Math.min(Math.max(1, num), 10);
    /** @type {Array<{ link: string; title: string; snippet: string }>} */
    const out = [];

    for (const item of raw.slice(0, cap)) {
      const original = String(item.original || "").trim();
      const thumb = String(item.thumbnail || "").trim();
      let link = "";
      if (original) {
        link = normalizeImageLink(original);
      } else if (thumb) {
        link = thumb.startsWith("http://")
          ? normalizeImageLink(thumb)
          : thumb;
      }
      if (!link.startsWith("https://")) {
        continue;
      }
      const title = String(item.title || item.source || "").trim();
      const snippet = String(item.source || "").trim();
      out.push({ link, title, snippet });
    }

    if (
      out.length === 0 &&
      process.env.NODE_ENV !== "production" &&
      raw.length === 0
    ) {
      imgLog.debug(
        { query: query.slice(0, 120), status: data.search_metadata?.status },
        "SerpAPI returned no images_results",
      );
    }

    return out;
  } catch (err) {
    imgLog.warn({ err }, "SerpAPI request failed");
    return [];
  }
}

async function searchImagesOneQuery(query, num) {
  return searchSerpImagesOneQuery(query, num);
}

/**
 * @param {Array<Array<{ link: string; title: string; snippet: string }>>} resultArrays
 * @param {number} maxTotal
 * @param {"strict" | "minimal"} mode
 */
function mergeRoundRobin(resultArrays, maxTotal, mode = "strict") {
  const seen = new Set();
  /** @type {Array<{ url: string; alt: string }>} */
  const out = [];
  const indices = resultArrays.map(() => 0);
  const filterFn =
    mode === "minimal" ? shouldFilterResultMinimal : shouldFilterResultStrict;

  while (out.length < maxTotal) {
    let added = false;
    for (let i = 0; i < resultArrays.length; i++) {
      const arr = resultArrays[i];
      while (indices[i] < arr.length && out.length < maxTotal) {
        const item = arr[indices[i]];
        indices[i] += 1;
        if (!item?.link) {
          continue;
        }
        const normUrl = normalizeImageLink(item.link);
        if (filterFn(normUrl, item.title, item.snippet)) {
          continue;
        }
        if (seen.has(normUrl)) {
          continue;
        }
        seen.add(normUrl);
        const alt = (item.title || item.snippet || "Reference image")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);
        out.push({ url: normUrl, alt: alt || "Reference image" });
        added = true;
        break;
      }
    }
    if (!added) {
      break;
    }
  }
  return out;
}

function cacheKey(queries, maxImages) {
  return `serp\u0000${[...queries].sort().join("\u0001")}\u0000${maxImages}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) {
      cache.delete(k);
    }
  }
  if (cache.size > 500) {
    const keys = [...cache.keys()].slice(0, 200);
    for (const k of keys) {
      cache.delete(k);
    }
  }
}

/**
 * @param {string[]} queriesInput
 * @param {number} [maxImages]
 * @returns {Promise<{ items: Array<{ url: string; alt: string }> }>}
 */
/** Sidebar “Images” mode can request more thumbnails; MCP / topic mode typically pass 4. */
const FETCH_IMAGES_MAX_CAP = 10;

export async function fetchImagesWithMetaFromQueries(
  queriesInput,
  maxImages = 4,
) {
  const cap = Math.min(
    Math.max(1, Number(maxImages) || 4),
    FETCH_IMAGES_MAX_CAP,
  );
  const seenQ = new Set();
  const queries = [];
  for (const q of queriesInput) {
    const s = String(q ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
    if (s && !seenQ.has(s)) {
      seenQ.add(s);
      queries.push(s);
    }
    if (queries.length >= 4) {
      break;
    }
  }

  const primaryForRetry = queries[0] || "reference";

  const hasSerp = Boolean(process.env.SERPAPI_API_KEY?.trim());
  if (!hasSerp) {
    return { items: [] };
  }
  if (queries.length === 0) {
    return { items: [] };
  }

  pruneCache();
  const ck = cacheKey(queries, cap);
  const now = Date.now();
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > now) {
    return { items: hit.items };
  }

  const resultArrays = await Promise.all(
    queries.map((q) => searchImagesOneQuery(q, 5)),
  );

  let merged = mergeRoundRobin(resultArrays, cap, "strict");

  if (merged.length === 0 && resultArrays.some((a) => a.length > 0)) {
    merged = mergeRoundRobin(
      resultArrays.map((a) => [...a]),
      cap,
      "minimal",
    );
  }

  if (merged.length === 0 && queries.length > 1 && primaryForRetry) {
    const fallbackArr = await searchImagesOneQuery(primaryForRetry, 5);
    merged = mergeRoundRobin([fallbackArr], cap, "strict");
    if (merged.length === 0 && fallbackArr.length > 0) {
      merged = mergeRoundRobin([[...fallbackArr]], cap, "minimal");
    }
  }

  cache.set(ck, { expiresAt: now + CACHE_TTL_MS, items: merged });
  return { items: merged };
}

/**
 * MCP / simple callers: one user query expanded with template suffixes only (no OpenAI).
 * @param {{ query: string; maxImages?: number }} opts
 * @returns {Promise<{ items: Array<{ url: string; alt: string }> }>}
 */
export async function fetchImagesWithMeta({ query, maxImages = 4 }) {
  const normalized = String(query ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const queries = templateFallbackQueries(normalized || "reference");
  return fetchImagesWithMetaFromQueries(queries, maxImages);
}

/**
 * MCP / simple consumers: URL list only.
 * @param {{ query: string; maxImages?: number }} opts
 * @returns {Promise<{ images: string[] }>}
 */
export async function fetchImages(opts) {
  const { items } = await fetchImagesWithMeta(opts);
  return { images: items.map((i) => i.url) };
}
