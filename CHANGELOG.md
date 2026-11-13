# Changelog

## Unreleased

- New tool `tarmac_server_status`: checks the server is reachable and which run modes it serves, so the agent can diagnose setup problems itself.
- `TARMAC_URL` is now optional and defaults to the hosted Tarmac (https://www.tarmacagent.com).
- When a server requires sign-in, `tarmac_start_run` explains how to create a run in the app and attach to it.

## 0.1.0

- First release: stdio MCP server with 8 tools (start/attach a run, context, balances, quote, swap, finish, run record).
