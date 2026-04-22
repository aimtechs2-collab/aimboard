import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

// Keep Prisma CLI behavior consistent with backend runtime scripts.
loadDotenv({ path: ".env.development.local" });

export default defineConfig({
  schema: "ai-backend/prisma/schema.prisma",
});
