#!/usr/bin/env node
/**
 * MCP server exposing `search_images` for Cursor / other MCP clients.
 * Loads the same Unsplash logic as the AimTutor ai-backend chat tool.
 *
 * Run: node mcp/search-images-server.mjs
 * Env: UNSPLASH_ACCESS_KEY (required for live results; empty returns [])
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchImages } from "../lib/searchImages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "aimtutor-search-images",
  version: "1.0.0",
});

server.registerTool(
  "search_images",
  {
    description:
      "Search Unsplash for relevant reference images (diagrams, places, objects, science). Returns 3–5 HTTPS image URLs with short alt text.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Specific search query, e.g. convex lens ray diagram physics",
        ),
    },
  },
  async ({ query }) => {
    const images = await searchImages({ query, max: 5 });
    const text = JSON.stringify(images);
    return {
      content: [{ type: "text", text }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[aimtutor-mcp] search_images server ready (cwd ${__dirname})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
