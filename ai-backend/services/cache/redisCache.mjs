const DEFAULT_PREFIX = "aifaboard";
const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024;

function buildFullKey(prefix, key) {
  return `${prefix}:${String(key)}`;
}

function parsePipelineResult(payload) {
  if (!payload || !Array.isArray(payload.result)) {
    return [];
  }
  return payload.result.map((entry) => {
    if (entry && Object.prototype.hasOwnProperty.call(entry, "result")) {
      return entry.result;
    }
    return null;
  });
}

export function createRedisCache({
  logger = console,
  prefix = DEFAULT_PREFIX,
  maxEntryBytes = DEFAULT_MAX_ENTRY_BYTES,
} = {}) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const enabled = Boolean(url && token);

  async function runPipeline(commands) {
    if (!enabled || !Array.isArray(commands) || commands.length === 0) {
      return [];
    }
    const endpoint = `${url.replace(/\/+$/, "")}/pipeline`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis pipeline failed (${response.status}): ${text}`);
    }
    const payload = await response.json();
    return parsePipelineResult(payload);
  }

  async function getJson(key) {
    if (!enabled) return null;
    try {
      const fullKey = buildFullKey(prefix, key);
      const [value] = await runPipeline([["GET", fullKey]]);
      if (typeof value !== "string" || value.length === 0) {
        return null;
      }
      return JSON.parse(value);
    } catch (err) {
      logger?.warn?.({ err, module: "redisCache", key }, "Redis GET failed");
      return null;
    }
  }

  async function setJson(key, value, { ttlSeconds = 20 } = {}) {
    if (!enabled) return false;
    try {
      const serialized = JSON.stringify(value);
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > maxEntryBytes) {
        return false;
      }
      const fullKey = buildFullKey(prefix, key);
      await runPipeline([["SETEX", fullKey, String(ttlSeconds), serialized]]);
      return true;
    } catch (err) {
      logger?.warn?.({ err, module: "redisCache", key }, "Redis SET failed");
      return false;
    }
  }

  async function del(key) {
    if (!enabled) return false;
    try {
      const fullKey = buildFullKey(prefix, key);
      await runPipeline([["DEL", fullKey]]);
      return true;
    } catch (err) {
      logger?.warn?.({ err, module: "redisCache", key }, "Redis DEL failed");
      return false;
    }
  }

  async function delMany(keys) {
    if (!enabled || !Array.isArray(keys) || keys.length === 0) {
      return false;
    }
    const fullKeys = keys.map((k) => buildFullKey(prefix, k));
    try {
      await runPipeline([["DEL", ...fullKeys]]);
      return true;
    } catch (err) {
      logger?.warn?.({ err, module: "redisCache", keyCount: keys.length }, "Redis DEL many failed");
      return false;
    }
  }

  return {
    enabled,
    getJson,
    setJson,
    del,
    delMany,
  };
}
