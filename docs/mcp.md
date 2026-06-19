# Baton MCP server

`baton-mcp` exposes Baton's verified handoff engine to any client that supports local MCP stdio servers. The process is pinned to one project directory and has no HTTP listener or Baton backend.

## Install and run

Baton requires Node 22.18 or newer because its published executables run TypeScript directly.

```sh
npm install -g https://github.com/mandatedisrael/Baton/releases/download/v0.2.0/baton-0.2.0.tgz

baton-mcp --project /absolute/path/to/project
```

`BATON_PROJECT_DIR=/absolute/path/to/project baton-mcp` is equivalent. Use an absolute path in client configuration so the server cannot drift with the client's working directory.

## Codex

Codex supports local stdio MCP servers in both the CLI and IDE extension. Add Baton with the CLI:

```sh
codex mcp add baton -- baton-mcp --project /absolute/path/to/project
```

Or add a project-scoped `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.baton]
command = "baton-mcp"
args = ["--project", "/absolute/path/to/project"]
required = true
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

The CLI and IDE share this configuration. Use `/mcp` in the Codex terminal UI to inspect the connected server. See the official [Codex MCP documentation](https://developers.openai.com/codex/mcp) for the current configuration surface.

## Generic stdio configuration

Clients using the common `mcpServers` JSON shape can launch Baton as follows:

```json
{
  "mcpServers": {
    "baton": {
      "command": "baton-mcp",
      "args": ["--project", "/absolute/path/to/project"]
    }
  }
}
```

Consult the client vendor's documentation for the location and exact name of its MCP configuration file. Baton uses the standard local stdio transport from the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Tools

| Tool | Effect |
|---|---|
| `baton_status` | Read the current project, head, mission, status, and checkpoint summary. |
| `baton_log` | List locally available hash-verified batons newest first. |
| `baton_search` | Search structured handoff content and file paths. |
| `baton_show` | Show a verified baton; a full remote ID may trigger authenticated recovery. |
| `baton_resume` | Recover if needed and render the canonical receiving-agent prompt. |
| `baton_verify` | Return the verified transcript lines cited by a decision or failed approach. |
| `baton_checkpoint` | Persist scrubbed self-reported latest truth. Supplied list sections replace; omitted sections remain. |
| `baton_pass` | Seal the current state and queue publication. Requires `confirm: true`. |

## Safety contract

- Stdout contains MCP protocol frames only. Diagnostics go to stderr or structured tool results.
- The server can access only the Baton project selected at startup plus Baton's protected user identity when remote recovery is required.
- Read tools verify local hashes. Remote-aware reads additionally verify the Sui manifest, Seal identity/package, Walrus payload, and recovered plaintext hashes.
- `baton_checkpoint` scrubs secrets before persistence and reports only finding counts.
- `baton_pass` is non-idempotent and requires explicit confirmation. It seals locally and queues publication; it does not silently spend storage funds.
- Tool errors remain MCP error results and must never be treated as verified project context.
