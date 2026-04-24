#!/usr/bin/env node
/**
 * MCP server exposing `search_images` for Cursor / other MCP clients.
 * Loads the same SerpAPI image-search logic as the AimTutor ai-backend chat tool.
 *
 * Run: node mcp/search-images-server.mjs
 * Env: SERPAPI_API_KEY (required for live results; empty returns [])
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { fetchImagesWithMeta } from "../lib/googleImageSearch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "aimtutor-search-images",
  version: "1.0.0",
});

server.registerTool(
  "search_images",
  {
    description:
      "Search web images (SerpAPI Google Images) for relevant references. Returns up to 5 HTTPS image URLs with short alt text.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Specific search query, e.g. convex lens ray diagram physics",
        ),
    },
  },
  async ({ query }) => {
    const { items } = await fetchImagesWithMeta({ query, maxImages: 5 });
    const text = JSON.stringify(items);
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
