#!/usr/bin/env node
/**
 * MCP server exposing `fetch_images` (web image search for diagrams / visuals).
 *
 * Run: node mcp/fetch-images-server.mjs
 * Env: SERPAPI_API_KEY
 * Query expansion: template suffixes only (no OpenAI in this process).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchImages } from "../lib/googleImageSearch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "aimboard-fetch-images",
  version: "1.0.0",
});

server.registerTool(
  "fetch_images",
  {
    description:
      "Search the web for diagrams, illustrations, and educational images (SerpAPI Google Images). Returns up to 4 HTTPS image URLs.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Search query, e.g. convex lens ray diagram physics",
        ),
      maxImages: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe("Max images to return (default 4, max 4)"),
    },
  },
  async ({ query, maxImages }) => {
    const { images } = await fetchImages({
      query,
      maxImages: maxImages ?? 4,
    });
    const text = JSON.stringify({ images });
    return {
      content: [{ type: "text", text }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[aimboard-mcp] fetch_images server ready (cwd ${__dirname})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
