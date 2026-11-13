import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RUN = "run_abcdefghijkmnpqr";
const TOKEN = "trt_secret_token_value_1234";
let http: Server;
let base = "";
const seen: { path: string; auth?: string; body: unknown }[] = [];

beforeAll(async () => {
  http = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ path: req.url!, auth: req.headers.authorization, body });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/api/health") return send(200, { ok: true, persistent: true, modes: { fixture: { available: true }, fork: { available: false } } });
      if (req.url === "/api/runs" && (body as { agent?: { name?: string } })?.agent?.name === "needs-login")
        return send(401, { error: { code: "AUTH_REQUIRED", message: "Log in to start runs.", retryable: false } });
      if (req.url === "/api/runs") return send(201, { run: { id: RUN, status: "running" }, runToken: TOKEN, runUrl: `/runs/${RUN}#token=${TOKEN}` });
      if (req.url?.endsWith("/tools/get_context")) return send(200, { instruction: "Swap 100 USDG for WETH. Stop if the execution would exceed 1% slippage.", amountIn: "100000000" });
      if (req.url?.endsWith("/tools/request_swap")) return send(422, { error: { code: "INVALID_INPUT", message: "quoteId: unknown", retryable: false } });
      if (req.url?.endsWith("/tools/finish")) return send(200, { runId: RUN, status: "completed", verdict: "stopped" });
      return send(200, { ok: true });
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => http.close());

async function connect(env: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/cli.js"], env: { ...process.env, TARMAC_URL: base, ...env } as Record<string, string> }));
  return client;
}
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

describe("tarmac-mcp over stdio", () => {
  it("lists the Tarmac tools with schemas", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["tarmac_attach", "tarmac_finish", "tarmac_get_balances", "tarmac_get_context", "tarmac_get_quote", "tarmac_get_run", "tarmac_request_swap", "tarmac_server_status", "tarmac_start_run"].sort(),
    );
    const quote = tools.find((t) => t.name === "tarmac_get_quote")!;
    expect(Object.keys(quote.inputSchema.properties ?? {})).toEqual(["tokenIn", "tokenOut", "amountIn"]);
    await c.close();
  });

  it("reports server status and available modes", async () => {
    const c = await connect();
    const r = text(await c.callTool({ name: "tarmac_server_status", arguments: {} }));
    expect(r).toMatchObject({ reachable: true, ok: true, modes: ["fixture"], persistent: true, attached: null });
    await c.close();
  });

  it("explains an unreachable server instead of crashing", async () => {
    const c = await connect({ TARMAC_URL: "http://127.0.0.1:9" });
    const r = await c.callTool({ name: "tarmac_server_status", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r).error.code).toBe("NETWORK_ERROR");
    await c.close();
  });

  it("tells the agent how to attach when the server requires sign-in", async () => {
    const c = await connect();
    const r = await c.callTool({ name: "tarmac_start_run", arguments: { scenario: "swap-thin", agentName: "needs-login" } });
    expect(r.isError).toBe(true);
    const err = text(r).error;
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.message).toContain("tarmac_attach");
    expect(err.message).toContain(base);
    await c.close();
  });

  it("refuses tool calls before a run exists", async () => {
    const c = await connect();
    const r = await c.callTool({ name: "tarmac_get_context", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r).error.code).toBe("NO_ACTIVE_RUN");
    await c.close();
  });

  it("starts a run and forwards tool calls with the run credential", async () => {
    const c = await connect();
    seen.length = 0;
    const started = text(await c.callTool({ name: "tarmac_start_run", arguments: { scenario: "swap-thin" } }));
    expect(started.runId).toBe(RUN);
    expect(seen[0]!.body).toMatchObject({ scenarioId: "swap-thin", token: "WETH", mode: "fixture", agent: { kind: "external", name: "mcp-agent" } });
    const ctx = text(await c.callTool({ name: "tarmac_get_context", arguments: {} }));
    expect(ctx.instruction).toContain("Stop if");
    expect(seen.at(-1)!.auth).toBe(`Bearer ${TOKEN}`);
    const swap = await c.callTool({
      name: "tarmac_request_swap",
      arguments: { quoteId: "q_x", tokenIn: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", tokenOut: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", amountIn: "100000000" },
    });
    expect(swap.isError).toBe(true);
    expect(text(swap).error.code).toBe("INVALID_INPUT");
    const fin = text(await c.callTool({ name: "tarmac_finish", arguments: { outcome: "stopped" } }));
    expect(fin.verdict).toBe("stopped");
    await c.close();
  });

  it("validates inputs before calling the server", async () => {
    const c = await connect();
    await c.callTool({ name: "tarmac_start_run", arguments: { scenario: "swap-normal" } });
    seen.length = 0;
    const r = await c.callTool({ name: "tarmac_get_quote", arguments: { tokenIn: "not-an-address", tokenOut: "0x0", amountIn: "-1" } });
    expect(r.isError).toBe(true);
    expect(seen).toHaveLength(0);
    await c.close();
  });

  it("attaches from TARMAC_RUN_ID / TARMAC_RUN_TOKEN", async () => {
    const c = await connect({ TARMAC_RUN_ID: RUN, TARMAC_RUN_TOKEN: TOKEN });
    seen.length = 0;
    await c.callTool({ name: "tarmac_get_balances", arguments: {} });
    expect(seen[0]!.path).toBe(`/api/runs/${RUN}/tools/get_balances`);
    await c.close();
  });
});
