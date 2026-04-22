/**
 * Load aifaboard/.env.development.local then run the Prisma CLI with Node.
 *
 * Uses `node …/prisma/build/index.js` instead of `npx prisma`, because in this
 * Yarn workspace `npx prisma` can resolve a broken path (`node_modules/node_modules/prisma`).
 *
 * Usage: node scripts/run-prisma-with-aifaboard-env.mjs db push --schema prisma/schema.prisma
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const aiBackendRoot = join(__dirname, "..");
const envPath = join(__dirname, "..", "..", ".env.development.local");
if (existsSync(envPath)) {
  config({ path: envPath });
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error("Usage: node scripts/run-prisma-with-aifaboard-env.mjs <prisma subcommand> [...]");
  process.exit(1);
}

const requireFromBackend = createRequire(join(aiBackendRoot, "package.json"));
let prismaCliMain;
try {
  prismaCliMain = join(dirname(requireFromBackend.resolve("prisma/package.json")), "build/index.js");
} catch {
  console.error(
    "Could not resolve the `prisma` package. From the monorepo root run `yarn install`, then retry.",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [prismaCliMain, ...prismaArgs], {
  stdio: "inherit",
  shell: false,
  env: process.env,
  cwd: aiBackendRoot,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
