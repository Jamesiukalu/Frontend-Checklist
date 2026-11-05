# Front-End Checklist MCP server

Lets AI assistants (Copilot, Claude, Cursor) audit a live page and look up checklist items. Free, no API key. It calls https://checklist.shinningtechservices.com (override with `CHECKLIST_BASE_URL`). Requires Node 18+.

Tools: `audit_page`, `get_checklist_item`, `search_checklist`.

## Use it

Install from npm (optional, `npx` also fetches it on first use):

```shell
npm i -g frontend-checklist-mcp
```

Then add it to your assistant's config, no clone needed:

```json
{
  "mcpServers": {
    "frontend-checklist": {
      "command": "npx",
      "args": ["-y", "frontend-checklist-mcp"]
    }
  }
}
```

VS Code uses the same command and args under `"servers"` in `.vscode/mcp.json`.

From a clone instead:

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "frontend-checklist": {
      "command": "node",
      "args": ["/absolute/path/to/Front-End-Checklist/mcp/server.mjs"]
    }
  }
}
```

Claude Desktop / Cursor (`mcpServers` in their config):

```json
{
  "mcpServers": {
    "frontend-checklist": {
      "command": "node",
      "args": ["/absolute/path/to/Front-End-Checklist/mcp/server.mjs"]
    }
  }
}
```

Then ask: "Audit https://example.com and fix the high priority issues."

The audit is one public page, without JavaScript, and is a starting point rather than a certification. Provided by [Shinning Tech Services](https://www.shinningtechservices.com/).
