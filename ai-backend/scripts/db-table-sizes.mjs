/**
 * Print disk usage per table in the connected Postgres database (public schema).
 *
 * Loads aifaboard/.env.development.local when present (NEON_DATABASE_URL).
 *
 * Usage: node scripts/db-table-sizes.mjs
 *         node scripts/db-table-sizes.mjs --exact   # include exact byte counts from Postgres
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = join(__dirname, "..", "..", ".env.development.local");
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

function stripChannelBinding(cs) {
  if (!cs || typeof cs !== "string" || !cs.includes("channel_binding")) return cs;
  const q = cs.indexOf("?");
  if (q === -1) return cs;
  const base = cs.slice(0, q);
  const tail = cs.slice(q + 1);
  const parts = tail.split("&").filter((p) => !/^channel_binding=/i.test(p.trim()));
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

/** MB if under 1024 MB, otherwise GB (binary units: 1024-based). */
function fmtMbOrGb(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return "0.00 MB";
  if (b >= BYTES_PER_GB) return `${(b / BYTES_PER_GB).toFixed(2)} GB`;
  return `${(b / BYTES_PER_MB).toFixed(2)} MB`;
}

async function main() {
  const exact = process.argv.includes("--exact");
  loadEnv();
  const url = stripChannelBinding(process.env.NEON_DATABASE_URL);
  if (!url) {
    console.error("NEON_DATABASE_URL is not set.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$connect();
    /* pg_table_size = heap + toast + FSM/VM (excludes indexes); matches large bytea like boards.scene_gzip */
    const rows = await prisma.$queryRaw`
      SELECT
        c.relname AS table_name,
        pg_total_relation_size(c.oid)::bigint AS total_bytes,
        pg_table_size(c.oid)::bigint AS table_bytes,
        (pg_indexes_size(c.oid))::bigint AS index_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC;
    `;

    const list = Array.isArray(rows) ? rows : [];
    let sum = 0n;
    for (const r of list) {
      sum += BigInt(r.total_bytes);
    }

    console.log("Units: MB below 1024 MB, else GB (1 MB = 1024×1024 bytes).\n");

    const sep = "\t";
    console.log(
      ["table", "total", "table+toast", "indexes"].join(sep),
    );
    console.log("-".repeat(60));
    for (const r of list) {
      const tb = BigInt(r.total_bytes);
      const hb = BigInt(r.table_bytes);
      const ib = BigInt(r.index_bytes);
      console.log(
        [r.table_name, fmtMbOrGb(tb), fmtMbOrGb(hb), fmtMbOrGb(ib)].join(sep),
      );
    }
    console.log("-".repeat(60));
    console.log(["TOTAL (public tables)", fmtMbOrGb(sum), "", ""].join(sep));

    if (exact) {
      console.log("\nExact bytes (from PostgreSQL catalog):\n");
      console.log(
        ["table", "total_bytes", "table+toast_bytes", "index_bytes"].join(sep),
      );
      console.log("-".repeat(72));
      for (const r of list) {
        console.log(
          [
            r.table_name,
            String(r.total_bytes),
            String(r.table_bytes),
            String(r.index_bytes),
          ].join(sep),
        );
      }
      console.log("-".repeat(72));
      console.log(["TOTAL (public tables)", String(sum), "", ""].join(sep));
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
