import { PrismaClient } from "@prisma/client";

import { observePrismaQuerySeconds } from "../utils/prometheus.mjs";

function stripChannelBindingFromConnectionString(cs) {
  if (!cs || typeof cs !== "string" || !cs.includes("channel_binding")) {
    return cs;
  }
  const qIdx = cs.indexOf("?");
  if (qIdx === -1) {
    return cs;
  }
  const base = cs.slice(0, qIdx);
  const tail = cs.slice(qIdx + 1);
  const parts = tail.split("&").filter((p) => !/^channel_binding=/i.test(p.trim()));
  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/**
 * Tune Prisma's Postgres URL for Neon pooler + bounded client pool load.
 * See: https://www.prisma.io/docs/guides/database/neon
 */
function finalizeDatabaseUrlForPrisma(raw) {
  if (!raw || typeof raw !== "string") {
    return raw;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = (url.hostname || "").toLowerCase();
  const isNeon = host.endsWith(".neon.tech") || host.includes("neon.tech");
  const params = url.searchParams;
  if (isNeon) {
    const usesPooler = host.includes("-pooler");
    if (usesPooler && !params.has("pgbouncer")) {
      params.set("pgbouncer", "true");
    }
    if (!params.has("connect_timeout")) {
      params.set("connect_timeout", "15");
    }
    if (!params.has("pool_timeout")) {
      params.set("pool_timeout", "15");
    }
  }
  const limRaw = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  if (limRaw) {
    const n = parseInt(limRaw, 10);
    if (Number.isFinite(n) && n > 0) {
      params.set("connection_limit", String(n));
    }
  }
  return url.toString();
}

let prismaInstance = null;

export function getPrisma() {
  if (prismaInstance) {
    return prismaInstance;
  }
  const stripped = stripChannelBindingFromConnectionString(process.env.NEON_DATABASE_URL);
  const datasourceUrl = stripped ? finalizeDatabaseUrlForPrisma(stripped) : stripped;
  prismaInstance = new PrismaClient({
    datasources: datasourceUrl
      ? {
          db: {
            url: datasourceUrl,
          },
        }
      : undefined,
  });
  prismaInstance.$use(async (params, next) => {
    const start = process.hrtime.bigint();
    const model = String(params.model ?? "$other");
    const action = String(params.action ?? "unknown");
    try {
      const result = await next(params);
      observePrismaQuerySeconds(
        model,
        action,
        Number(process.hrtime.bigint() - start) / 1e9,
        false,
      );
      return result;
    } catch (err) {
      observePrismaQuerySeconds(
        model,
        action,
        Number(process.hrtime.bigint() - start) / 1e9,
        true,
      );
      throw err;
    }
  });
  return prismaInstance;
}

export async function pgQuery(text, params = []) {
  const rows = await getPrisma().$queryRawUnsafe(text, ...(params || []));
  return {
    rows: Array.isArray(rows) ? rows : [],
    rowCount: Array.isArray(rows) ? rows.length : 0,
  };
}

export async function pgExecute(text, params = []) {
  return getPrisma().$executeRawUnsafe(text, ...(params || []));
}
