#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTarmacMcpServer } from "./server.ts";

const baseUrl = process.env.TARMAC_URL;
if (!baseUrl) {
  console.error("tarmac-mcp: set TARMAC_URL to your Tarmac server, e.g. TARMAC_URL=https://your-tarmac-server");
  process.exit(1);
}
const server = createTarmacMcpServer({ baseUrl, runId: process.env.TARMAC_RUN_ID, runToken: process.env.TARMAC_RUN_TOKEN });
await server.connect(new StdioServerTransport());
console.error(`tarmac-mcp connected to ${new URL(baseUrl).host}`);
