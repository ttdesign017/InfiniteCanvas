# Live Agent Bridge (IC2 ↔ MCP)

> Enables Codex (or any MCP client) to place research on the **open canvas** in realtime.

## How it works

```
Codex  →  ic2-mcp  →  %LOCALAPPDATA%/InfiniteCanvas/agent/req-*.json
                              ↑ poll (~350ms)
                     Infinite Canvas (useAgentBridge)
                              ↓
                       res-*.json  →  MCP
```

1. **App** writes `session.json` every 2s (`aliveAt`, board name/path, `allowAgentWrite`).
2. **MCP** detects a fresh session (alive &lt; 8s) → **live mode**.
3. MCP writes a request file; the app applies ops via `board-ops` + one `pushHistory`.
4. If the app is closed, MCP falls back to **file mode** (`ic2_board_open` / save).

## Paths (Windows)

`%LOCALAPPDATA%\InfiniteCanvas\agent\`

- `session.json` — heartbeat  
- `req-<uuid>.json` — request  
- `res-<uuid>.json` — response  

## Product workflow: brand research

1. Open **Infinite Canvas 2** (empty board or a sandbox board).  
2. Codex has MCP `ic2` with write enabled.  
3. Prompt: *「帮我调研 songmont 的品牌视觉」*  
4. Prefer **progressive** writes (skill `ic2-moodboard`): open stack →  
   append each finished section via `ic2_append_cluster` / `stackId`  
   so the user sees chunks as research completes (not one final dump).  
5. Content appears live per MCP call; user **Ctrl+S** to persist.

## Tools (highlights)

| Tool | Role |
|------|------|
| `ic2_status` | live vs file; `dirty` / `pendingUserSave` / `revision` |
| `ic2_get_viewport` | place near what user sees |
| `ic2_create_note` / `ic2_create_text` | body notes + floating large type (`role`) |
| `ic2_create_link` / `import_image_url` | pages vs **real images** |
| `ic2_create_stack` / `ic2_get_stack` / `move_to_container` / `layout_grid` | structure |
| `ic2_add_research_cluster` | **preferred** mood board (`images` + typed notes) |

## Write response envelope (v2)

Mutations return more than ids:

```json
{
  "ok": true,
  "createdIds": ["note_…"],
  "createdStackIds": ["stack_…"],
  "verified": { "items": ["note_…"], "stacks": ["stack_…"] },
  "revision": 3,
  "persisted": "live",
  "visibleInLiveBoard": true,
  "dirty": true,
  "pendingUserSave": true,
  "autoSaved": false,
  "warnings": ["image download skipped: …"]
}
```

| Field | Meaning |
|-------|---------|
| `createdIds` | **Items only** — never use with `get_item` for stacks |
| `createdStackIds` | Stack folders — use `ic2_get_stack` / `list_items(containerId=stackId)` |
| `verified` | Read-after-write; missing ids → error, not fake success |
| `persisted` | `live` \| `memory` (file session) \| `disk` (after save) |
| `pendingUserSave` | Live app needs Ctrl+S |
| `dirty` | Unsaved changes exist |

**Counts:** `meta.itemCount` is global; `meta.rootItemCount` / `list_items.total` are per-surface. Nested notes live inside stacks, so `itemCount > list_items(root).total` is normal.

## Security

- Loopback-ish file drop under user LOCALAPPDATA only.  
- Image fetch blocks private hosts; max ~12MB.  
- `IC2_MCP_ALLOW_WRITE=0` disables MCP-side writes.  
- Live app can set `allowAgentWrite: false` in session (future UI toggle).  

## Codex config (example)

```toml
[mcp_servers.ic2]
command = "npx"
args = ["--prefix", "C:/…/packages/ic2-mcp", "tsx", "C:/…/packages/ic2-mcp/src/index.ts"]
startup_timeout_sec = 120

[mcp_servers.ic2.env]
IC2_MCP_ALLOW_WRITE = "1"
# Optional file fallback only:
# IC2_MCP_BOARD_PATH = "C:/Users/…/Desktop/sandbox.icanvas"
```

Prefer **no** `BOARD_PATH` when using live mode so the agent targets the open window.
