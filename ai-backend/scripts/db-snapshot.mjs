/**
 * Export full Prisma/Postgres data to a JSON snapshot file, or seed a DB from that file.
 *
 * Loads aifaboard/.env.development.local when present (same as other ai-backend scripts).
 *
 * Export (uses NEON_DATABASE_URL):
 *   node scripts/db-snapshot.mjs export
 *   node scripts/db-snapshot.mjs export --out ./backups/snapshot.json
 *
 * Seed (truncates ALL listed tables, then inserts — destructive on target DB):
 *   node scripts/db-snapshot.mjs seed --file ./backups/snapshot.json --yes
 *   CONFIRM_DB_SEED=1 node scripts/db-snapshot.mjs seed --file ./snap.json
 *
 * Optional URL override for either command:
 *   NEON_DATABASE_URL="postgresql://..." node scripts/db-snapshot.mjs export
 *
 * Prerequisite for seed: schema exists on target (e.g. prisma db push / migrate).
 */
import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_VERSION = 1;

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

function clientForUrl(url) {
  const u = stripChannelBinding(url);
  if (!u) return null;
  return new PrismaClient({
    log: [],
    datasources: { db: { url: u } },
  });
}

/** JSON.stringify replacer: BigInt + binary Bytes → portable JSON (markers unlikely inside app Json columns) */
function snapshotReplacer(_key, value) {
  if (typeof value === "bigint") {
    return { __aimboardDbSnap: "BigInt", v: value.toString() };
  }
  if (Buffer.isBuffer(value)) {
    return { __aimboardDbSnap: "Bytes", v: value.toString("base64") };
  }
  return value;
}

/** Revive values produced by snapshotReplacer */
function snapshotReviver(_key, value) {
  if (value && typeof value === "object" && value.__aimboardDbSnap === "BigInt") {
    return BigInt(value.v);
  }
  if (value && typeof value === "object" && value.__aimboardDbSnap === "Bytes") {
    return Buffer.from(value.v, "base64");
  }
  return value;
}

async function readAllTables(prisma) {
  const [
    users,
    workspaces,
    folders,
    boards,
    sessions,
    messages,
    aiUsage,
    apiLogs,
    activity,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.workspace.findMany(),
    prisma.folder.findMany(),
    prisma.board.findMany(),
    prisma.boardAiChatSession.findMany(),
    prisma.boardAiChatMessage.findMany(),
    prisma.aiUsageEvent.findMany(),
    prisma.apiProcessLog.findMany(),
    prisma.userActivityEvent.findMany(),
  ]);
  return {
    users,
    workspaces,
    folders,
    boards,
    boardAiChatSessions: sessions,
    boardAiChatMessages: messages,
    aiUsageEvents: aiUsage,
    apiProcessLogs: apiLogs,
    userActivityEvents: activity,
  };
}

async function truncateAll(prisma) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      board_ai_chat_messages,
      board_ai_chat_sessions,
      boards,
      folders,
      workspaces,
      user_activity_events,
      api_process_logs,
      ai_usage_events,
      users
    RESTART IDENTITY CASCADE
  `);
}

async function chunkedCreateMany(createManyFn, rows, size) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (chunk.length) await createManyFn(chunk);
  }
}

/**
 * After inserting explicit primary keys, bump sequences so the next DEFAULT id is safe.
 */
async function alignSequences(prisma) {
  const specs = [
    ["users", "id"],
    ["ai_usage_events", "id"],
    ["api_process_logs", "id"],
    ["user_activity_events", "id"],
    ["workspaces", "id"],
    ["folders", "id"],
    ["boards", "id"],
    ["board_ai_chat_sessions", "id"],
    ["board_ai_chat_messages", "id"],
  ];
  for (const [table, col] of specs) {
    await prisma.$executeRawUnsafe(`
      SELECT setval(
        pg_get_serial_sequence('${table}', '${col}'),
        COALESCE((SELECT MAX("${col}")::bigint FROM "${table}"), 1),
        true
      )
    `);
  }
}

function parseArgs(argv) {
  const cmd = argv[2];
  const rest = argv.slice(3);
  const out = { cmd, outPath: null, file: null, yes: false };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--out" && rest[i + 1]) out.outPath = rest[++i];
    else if (rest[i] === "--file" && rest[i + 1]) out.file = rest[++i];
    else if (rest[i] === "--yes") out.yes = true;
  }
  return out;
}

async function cmdExport(outPath) {
  loadEnv();
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("NEON_DATABASE_URL is not set (add to .env.development.local or env).");
    process.exit(1);
  }
  const prisma = clientForUrl(url);
  try {
    await prisma.$connect();
    const data = await readAllTables(prisma);
    const payload = {
      snapshotVersion: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      ...data,
    };
    const json = JSON.stringify(payload, snapshotReplacer, 2);
    const target =
      outPath ||
      join(
        __dirname,
        "..",
        "db-snapshots",
        `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
    const dir = dirname(target);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(target, json, "utf8");
    console.error(`Wrote ${target} (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MiB)`);
    console.error(
      `Counts: users=${data.users.length} workspaces=${data.workspaces.length} folders=${data.folders.length} boards=${data.boards.length} chatSessions=${data.boardAiChatSessions.length} chatMessages=${data.boardAiChatMessages.length} aiUsage=${data.aiUsageEvents.length} apiLogs=${data.apiProcessLogs.length} activity=${data.userActivityEvents.length}`,
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function cmdSeed(file, yes) {
  loadEnv();
  if (!file) {
    console.error("Usage: node scripts/db-snapshot.mjs seed --file <snapshot.json> --yes");
    process.exit(1);
  }
  if (!yes && process.env.CONFIRM_DB_SEED !== "1") {
    console.error(
      "Refusing to seed without confirmation. Pass --yes or set CONFIRM_DB_SEED=1. This TRUNCATES all application tables on NEON_DATABASE_URL.",
    );
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("NEON_DATABASE_URL is not set.");
    process.exit(1);
  }
  const raw = readFileSync(file, "utf8");
  const snap = JSON.parse(raw, snapshotReviver);
  if (snap.snapshotVersion !== SNAPSHOT_VERSION) {
    console.error(
      `Unsupported snapshotVersion=${snap.snapshotVersion} (expected ${SNAPSHOT_VERSION}).`,
    );
    process.exit(1);
  }

  const prisma = clientForUrl(url);
  try {
    await prisma.$connect();
    console.error("Truncating target database …");
    await truncateAll(prisma);

    const {
      users,
      workspaces,
      folders,
      boards,
      boardAiChatSessions,
      boardAiChatMessages,
      aiUsageEvents,
      apiProcessLogs,
      userActivityEvents,
    } = snap;

    console.error("Inserting rows …");
    await chunkedCreateMany((c) => prisma.user.createMany({ data: c }), users, 300);
    await chunkedCreateMany((c) => prisma.workspace.createMany({ data: c }), workspaces, 300);
    await chunkedCreateMany((c) => prisma.folder.createMany({ data: c }), folders, 400);
    await chunkedCreateMany((c) => prisma.board.createMany({ data: c }), boards, 40);
    await chunkedCreateMany(
      (c) => prisma.boardAiChatSession.createMany({ data: c }),
      boardAiChatSessions,
      200,
    );
    await chunkedCreateMany(
      (c) => prisma.boardAiChatMessage.createMany({ data: c }),
      boardAiChatMessages,
      500,
    );
    await chunkedCreateMany((c) => prisma.aiUsageEvent.createMany({ data: c }), aiUsageEvents, 500);
    await chunkedCreateMany(
      (c) => prisma.apiProcessLog.createMany({ data: c }),
      apiProcessLogs,
      500,
    );
    await chunkedCreateMany(
      (c) => prisma.userActivityEvent.createMany({ data: c }),
      userActivityEvents,
      500,
    );

    console.error("Aligning sequences …");
    await alignSequences(prisma);
    console.error("Seed complete.");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

async function main() {
  const { cmd, outPath, file, yes } = parseArgs(process.argv);
  if (cmd === "export") {
    await cmdExport(outPath);
    return;
  }
  if (cmd === "seed") {
    await cmdSeed(file, yes);
    return;
  }
  console.error(`Usage:
  node scripts/db-snapshot.mjs export [--out path.json]
  node scripts/db-snapshot.mjs seed --file path.json --yes`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
