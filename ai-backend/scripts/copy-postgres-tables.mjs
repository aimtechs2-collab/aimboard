/**
 * Copy all Prisma-mapped tables from one Postgres URL to another (fast batched createMany).
 *
 * Loads aifaboard/.env.development.local if present (for NEON_DATABASE_URL as default source).
 *
 * Usage:
 *   NEON_DATABASE_TARGET_URL="postgresql://..." node scripts/copy-postgres-tables.mjs
 *
 * Optional overrides:
 *   NEON_DATABASE_SOURCE_URL — source (defaults to NEON_DATABASE_URL)
 *   --source <url> / --target <url> (CLI wins over env)
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));

function stripChannelBinding(cs) {
  if (!cs || typeof cs !== "string" || !cs.includes("channel_binding")) return cs;
  const q = cs.indexOf("?");
  if (q === -1) return cs;
  const base = cs.slice(0, q);
  const tail = cs.slice(q + 1);
  const parts = tail.split("&").filter((p) => !/^channel_binding=/i.test(p.trim()));
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

function parseArgs(argv) {
  const out = { source: null, target: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) {
      out.source = argv[++i];
    } else if (argv[i] === "--target" && argv[i + 1]) {
      out.target = argv[++i];
    }
  }
  return out;
}

function loadEnv() {
  const envPath = join(__dirname, "..", "..", ".env.development.local");
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

function clientForUrl(url) {
  const u = stripChannelBinding(url);
  return new PrismaClient({
    log: [],
    datasources: { db: { url: u } },
  });
}

async function chunkedCreateMany(createManyFn, rows, size) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (chunk.length) await createManyFn(chunk);
  }
}

async function truncateAll(target) {
  await target.$executeRawUnsafe(`
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

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  const sourceUrl =
    args.source ||
    process.env.NEON_DATABASE_SOURCE_URL ||
    process.env.NEON_DATABASE_URL;
  const targetUrl = args.target || process.env.NEON_DATABASE_TARGET_URL;

  if (!sourceUrl || !targetUrl) {
    console.error(
      "Set NEON_DATABASE_TARGET_URL (and source: NEON_DATABASE_URL or NEON_DATABASE_SOURCE_URL), or pass --source / --target.",
    );
    process.exit(1);
  }
  if (stripChannelBinding(sourceUrl) === stripChannelBinding(targetUrl)) {
    console.error("Source and target URLs must differ.");
    process.exit(1);
  }

  const source = clientForUrl(sourceUrl);
  const target = clientForUrl(targetUrl);

  try {
    await target.$connect();
    await source.$connect();

    console.error("Truncating target …");
    await truncateAll(target);

    console.error("Reading source …");
    const users = await source.user.findMany();
    const workspaces = await source.workspace.findMany();
    const folders = await source.folder.findMany();
    const boards = await source.board.findMany();
    const sessions = await source.boardAiChatSession.findMany();
    const messages = await source.boardAiChatMessage.findMany();
    const aiUsage = await source.aiUsageEvent.findMany();
    const apiLogs = await source.apiProcessLog.findMany();
    const activity = await source.userActivityEvent.findMany();

    console.error(
      `Copying rows: users=${users.length} workspaces=${workspaces.length} folders=${folders.length} boards=${boards.length} sessions=${sessions.length} messages=${messages.length} ai_usage=${aiUsage.length} api_logs=${apiLogs.length} activity=${activity.length}`,
    );

    await chunkedCreateMany((c) => target.user.createMany({ data: c }), users, 300);
    await chunkedCreateMany(
      (c) => target.workspace.createMany({ data: c }),
      workspaces,
      300,
    );
    await chunkedCreateMany((c) => target.folder.createMany({ data: c }), folders, 400);
    await chunkedCreateMany((c) => target.board.createMany({ data: c }), boards, 40);
    await chunkedCreateMany(
      (c) => target.boardAiChatSession.createMany({ data: c }),
      sessions,
      200,
    );
    await chunkedCreateMany(
      (c) => target.boardAiChatMessage.createMany({ data: c }),
      messages,
      500,
    );
    await chunkedCreateMany(
      (c) => target.aiUsageEvent.createMany({ data: c }),
      aiUsage,
      500,
    );
    await chunkedCreateMany(
      (c) => target.apiProcessLog.createMany({ data: c }),
      apiLogs,
      500,
    );
    await chunkedCreateMany(
      (c) => target.userActivityEvent.createMany({ data: c }),
      activity,
      500,
    );

    console.error("Done.");
  } finally {
    await source.$disconnect().catch(() => {});
    await target.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
