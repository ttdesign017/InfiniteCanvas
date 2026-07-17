# @ic2/mcp

MCP server for **Infinite Canvas 2** — external agents read/write boards through `src/board-ops` (file mode).

| | |
|--|--|
| Transport | **stdio** |
| Domain API | `src/board-ops` (repo root) |
| Contract | `docs/MCP.md`, `docs/BOARD_OPS.md` |
| Default write | **off** (`IC2_MCP_ALLOW_WRITE=1` to enable) |

## Setup

From this directory:

```bash
npm install
```

From repo root (optional convenience scripts — see root `package.json`):

```bash
npm run mcp:install
npm run mcp:start
```

Requires **Node ≥ 20**.

## Run

```bash
# read-only
npm start

# open a board at start + allow writes
set IC2_MCP_ALLOW_WRITE=1
set IC2_MCP_BOARD_PATH=D:\path\to\board.icanvas
npm start
```

Logs go to **stderr**; MCP JSON-RPC uses **stdout** (do not `console.log` in tools).

## Claude Desktop / Cursor (example)

```json
{
  "mcpServers": {
    "infinite-canvas-2": {
      "command": "npx",
      "args": ["tsx", "C:/Users/YOU/Documents/trae_projects/InfiniteCanvas2/packages/ic2-mcp/src/index.ts"],
      "env": {
        "IC2_MCP_ALLOW_WRITE": "0"
      }
    }
  }
}
```

Or after `npm install` in this package:

```json
{
  "mcpServers": {
    "infinite-canvas-2": {
      "command": "npx",
      "args": [
        "tsx",
        "C:/…/InfiniteCanvas2/packages/ic2-mcp/src/index.ts"
      ],
      "cwd": "C:/…/InfiniteCanvas2/packages/ic2-mcp",
      "env": {
        "IC2_MCP_ALLOW_WRITE": "1",
        "IC2_MCP_BOARD_PATH": "C:/…/my-board.icanvas"
      }
    }
  }
}
```

Use absolute paths. Prefer `allowWrite: 0` until you trust the agent.

## Tools

| Tool | Write? | Purpose |
|------|--------|---------|
| `ic2_board_open` | | Bind a `.icanvas` path |
| `ic2_board_info` | | Meta + dirty + allowWrite |
| `ic2_board_save` | ✓ | Atomic write (keeps packed assets) |
| `ic2_tree` | | Nested stacks |
| `ic2_list_items` | | Summaries in **one** `containerId` |
| `ic2_get_item` | | Detail without media bytes |
| `ic2_export_text` | | Notes/links as text |
| `ic2_search` | | Substring search |
| `ic2_create_note` | ✓ | One note (`dry_run` supported) |
| `ic2_create_notes` | ✓ | Batch notes |
| `ic2_update_text` | ✓ | Whitelist text fields |
| `ic2_move_items` | ✓ | Absolute pose |

`containerId`: use `root` for the home canvas.

## Architecture

```
packages/ic2-mcp  →  src/board-ops  →  BoardSnapshot / DTOs
       │
       └─ nodeFile.ts (Node fs; no Tauri)
```

- **App UI** still uses Tauri `boardIO` / `fileOps`.
- **MCP** uses `nodeFile` so it runs as a plain Node process.
- Save preserves `packedAssets` from open (does not re-encode media from blob URLs).

## Not in this package (yet)

- Live session bridge into a running Tauri window  
- Delete / nest / layout-suggest tools  
- OAuth / remote HTTP transport  

## Dev

```bash
npm run typecheck   # tsc --noEmit (paths into repo src)
npm start
```
