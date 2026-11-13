#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTarmacMcpServer } from "./server.ts";

/** The hosted Tarmac. Set TARMAC_URL to use your own server. */
const DEFAULT_URL = "https://www.tarmacagent.com";
const baseUrl = process.env.TARMAC_URL || DEFAULT_URL;
try {
  new URL(baseUrl);
} catch {
  console.error(`tarmac-mcp: TARMAC_URL is not a valid URL: ${baseUrl}`);
  process.exit(1);
}
const server = createTarmacMcpServer({ baseUrl, runId: process.env.TARMAC_RUN_ID, runToken: process.env.TARMAC_RUN_TOKEN });
await server.connect(new StdioServerTransport());
console.error(`tarmac-mcp connected to ${new URL(baseUrl).host}`);
