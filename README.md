# @tarmacagent/mcp

[![ci](https://github.com/tarmacagent/tarmac-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tarmacagent/tarmac-mcp/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@tarmacagent/mcp)](https://www.npmjs.com/package/@tarmacagent/mcp) ![license](https://img.shields.io/badge/license-MIT-black)

**Let any MCP agent test on-chain actions before it goes live.**

An [MCP](https://modelcontextprotocol.io) server for Tarmac. Claude, Cursor, or any agent framework that speaks MCP gets Tarmac's tools: start a run on a live fork of Robinhood Chain, read balances, quote, request a swap. Every request passes Tarmac's policy checks, and every call lands in a trace you can open in the browser. The agent never holds a key.

## Setup

### Claude Code

```bash
claude mcp add tarmac -e TARMAC_URL=https://your-tarmac-server -- npx -y @tarmacagent/mcp
```

### Claude Desktop / Cursor / other clients

```json
{
  "mcpServers": {
    "tarmac": {
      "command": "npx",
      "args": ["-y", "@tarmacagent/mcp"],
      "env": { "TARMAC_URL": "https://your-tarmac-server" }
    }
  }
}
```

If the server requires sign-in, create a run in the Tarmac app (**Run → Your agent**) and add `TARMAC_RUN_ID` and `TARMAC_RUN_TOKEN` to `env`. The server attaches to that run on startup.

## Tools

| Tool | What it does |
| --- | --- |
| `tarmac_server_status` | Is the server reachable, and which run modes (`fixture`, `fork`) does it serve |
| `tarmac_start_run` | Start a run: `scenario` (`swap-normal` / `swap-thin`), `token` (`WETH` / `NVDA`), `mode` (`fork` = live chain state, `fixture`) |
| `tarmac_attach` | Attach to a run created in the app |
| `tarmac_get_context` | Instruction, simulated wallet, token addresses, amount, policy limits |
| `tarmac_get_balances` | Simulated wallet balances (base units) |
| `tarmac_get_quote` | Quote with `slippageBps` against the reference mid price |
| `tarmac_request_swap` | Request a swap; blocked and recorded if any policy check fails |
| `tarmac_finish` | End the run; returns the verdict and trace link |
| `tarmac_get_run` | Status, verdict, reason and balance changes |

Inputs are validated before anything reaches the server: addresses must be 20-byte hex and amounts integer strings.

## Try it

Ask your agent:

> Start a Tarmac run on the thin pool. Follow the instruction exactly, then tell me the verdict and why.

## Development

```bash
npm install
npm test   # builds, then drives the real stdio server with an MCP client
```

## Related

- [tarmac-sdk-ts](https://github.com/tarmacagent/tarmac-sdk-ts) · [tarmac-python](https://github.com/tarmacagent/tarmac-python) · [tarmac-examples](https://github.com/tarmacagent/tarmac-examples)

## License

MIT
