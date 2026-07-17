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
4. Codex should: web research → `ic2_status` → `ic2_get_viewport` →  
   `ic2_add_research_cluster` (notes + links + image URLs).  
5. Cards appear on the live canvas; user **Ctrl+S** to persist.

## Tools (highlights)

| Tool | Role |
|------|------|
| `ic2_status` | live vs file |
| `ic2_get_viewport` | place near what user sees |
| `ic2_create_note` / `create_link` / `import_image_url` | primitives |
| `ic2_create_stack` / `move_to_container` / `layout_grid` | structure |
| `ic2_add_research_cluster` | **preferred** one-shot mood board dump |

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
