import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTarmacClient, TarmacToolError, type RunSession } from "@tarmacagent/sdk";
import { z } from "zod";

export interface ServerOptions {
  /** Tarmac server, e.g. https://your-tarmac-server */
  baseUrl: string;
  /** Attach to an existing run on startup (created in the app with "Your agent"). */
  runId?: string;
  runToken?: string;
  fetch?: typeof fetch;
}

const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => {
  const err = e instanceof TarmacToolError ? { code: e.code, message: e.message, retryable: e.retryable } : { code: "ERROR", message: (e as Error).message, retryable: false };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: err }, null, 2) }] };
};

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x-prefixed 20-byte address");
const baseUnits = z.string().regex(/^\d+$/, "integer amount in base units, as a string");

/**
 * Tarmac as an MCP server. An MCP client (Claude, Cursor, any agent framework)
 * starts or attaches to a run, then acts through the same five tools the
 * TypeScript and Python SDKs expose. Policy is enforced by the Tarmac server.
 */
export function createTarmacMcpServer(opts: ServerOptions) {
  const client = createTarmacClient({ baseUrl: opts.baseUrl, fetch: opts.fetch });
  let session: RunSession | null = opts.runId && opts.runToken ? client.attach(opts.runId, opts.runToken) : null;

  const server = new McpServer({ name: "tarmac", version: "0.1.0" });
  const active = () => {
    if (!session) throw new TarmacToolError("NO_ACTIVE_RUN", "Start a run with tarmac_start_run (or attach with tarmac_attach) first.");
    return session;
  };
  const guard =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        return ok(await fn(args));
      } catch (e) {
        return fail(e);
      }
    };

  server.registerTool(
    "tarmac_start_run",
    {
      title: "Start a Tarmac run",
      description:
        "Start a new test run: an isolated simulated wallet on Robinhood Chain (live fork or fixture market). The run's instruction is: swap 100 USDG for the token, stop if slippage would exceed the limit. Returns the run id and a link to the trace.",
      inputSchema: {
        scenario: z.enum(["swap-normal", "swap-thin"]).describe("Market condition: deep pool or thin pool"),
        token: z.enum(["WETH", "NVDA"]).default("WETH").describe("Token to buy with USDG"),
        mode: z.enum(["fixture", "fork"]).default("fixture").describe("fork = live Robinhood Chain state; fixture = deterministic market"),
        agentName: z.string().min(1).max(48).default("mcp-agent").describe("Name shown in the trace"),
      },
      annotations: { openWorldHint: true },
    },
    guard(async ({ scenario, token, mode, agentName }) => {
      session = await client.startRun({ scenario, token, mode, agentName });
      return { runId: session.runId, runUrl: session.runUrl, next: "Call tarmac_get_context to read the instruction and policy." };
    }),
  );

  server.registerTool(
    "tarmac_attach",
    {
      title: "Attach to an existing run",
      description: "Attach to a run created in the Tarmac app (Run → Your agent) using its run id and run credential.",
      inputSchema: { runId: z.string().regex(/^run_[a-z2-9]{16}$/), runToken: z.string().startsWith("trt_") },
    },
    guard(async ({ runId, runToken }) => {
      session = client.attach(runId, runToken);
      return { runId, attached: true };
    }),
  );

  server.registerTool(
    "tarmac_get_context",
    { title: "Read the run's instruction and limits", description: "Instruction, simulated wallet, token addresses, amount and policy limits for the active run.", annotations: { readOnlyHint: true } },
    guard(async () => active().tools.getContext()),
  );

  server.registerTool(
    "tarmac_get_balances",
    { title: "Read wallet balances", description: "Balances of the simulated wallet, in integer base units.", annotations: { readOnlyHint: true } },
    guard(async () => active().tools.getBalances()),
  );

  server.registerTool(
    "tarmac_get_quote",
    {
      title: "Get a swap quote",
      description: "Quote tokenIn → tokenOut. Returns quoteId, amountOut, the reference (mid) output and slippageBps. Compare slippageBps to the policy limit before swapping.",
      inputSchema: { tokenIn: address, tokenOut: address, amountIn: baseUnits },
      annotations: { readOnlyHint: true },
    },
    guard(async (args) => active().tools.getQuote(args as never)),
  );

  server.registerTool(
    "tarmac_request_swap",
    {
      title: "Request a swap",
      description:
        "Ask Tarmac to execute a quoted swap from the simulated wallet. Every request is checked by the policy layer (tokens, router, recipient, spend cap, freshness, slippage, minimum output); a failing request is blocked and recorded.",
      inputSchema: {
        quoteId: z.string(),
        tokenIn: address,
        tokenOut: address,
        amountIn: baseUnits,
        minAmountOut: baseUnits.optional(),
        reason: z.string().max(500).optional().describe("Why — recorded in the trace, never used for the decision"),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    guard(async (args) => active().tools.requestSwap(args as never)),
  );

  server.registerTool(
    "tarmac_finish",
    {
      title: "Finish the run",
      description: "End the run. The verdict is computed from recorded checks, not from this summary.",
      inputSchema: { outcome: z.enum(["swapped", "stopped"]), summary: z.string().max(500).optional() },
    },
    guard(async ({ outcome, summary }) => {
      const s = active();
      const res = await s.tools.finish({ outcome, summary });
      return { ...res, runUrl: s.runUrl };
    }),
  );

  server.registerTool(
    "tarmac_get_run",
    { title: "Get the run record", description: "Status, verdict, reason and balance changes for the active run.", annotations: { readOnlyHint: true } },
    guard(async () => {
      const run = (await active().getRun()) as Record<string, unknown>;
      const { events: _events, ...rest } = run;
      return rest;
    }),
  );

  return server;
}
