import { PrismaClient } from "@prisma/client";

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

let prismaInstance = null;

export function getPrisma() {
  if (prismaInstance) {
    return prismaInstance;
  }
  const datasourceUrl = stripChannelBindingFromConnectionString(
    process.env.NEON_DATABASE_URL,
  );
  prismaInstance = new PrismaClient({
    datasources: datasourceUrl
      ? {
          db: {
            url: datasourceUrl,
          },
        }
      : undefined,
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
