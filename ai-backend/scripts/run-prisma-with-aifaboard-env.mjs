/**
 * Load aifaboard/.env.development.local then exec `npx prisma <args>`.
 * Usage: node scripts/run-prisma-with-aifaboard-env.mjs db push --schema prisma/schema.prisma
 */
import { spawn } from "node:child_process";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", "..", ".env.development.local");
if (existsSync(envPath)) {
  config({ path: envPath });
}

const prismaArgs = process.argv.slice(2);
if (prismaArgs.length === 0) {
  console.error("Usage: node scripts/run-prisma-with-aifaboard-env.mjs <prisma subcommand> [...]");
  process.exit(1);
}

const child = spawn("npx", ["prisma", ...prismaArgs], {
  stdio: "inherit",
  shell: true,
  env: process.env,
  cwd: join(__dirname, ".."),
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
