# @ic2/mcp

MCP server for **Infinite Canvas 2** — agents research and **place content on the canvas**.

| Mode | When | Behavior |
|------|------|----------|
| **Live** | Infinite Canvas is open (heartbeat) | Ops appear on the **open window** immediately |
| **File** | App closed + `ic2_board_open` | Mutate in-memory snapshot; `ic2_board_save` writes `.icanvas` |

See `docs/AGENT_BRIDGE.md` and `docs/CODEX_BRAND_RESEARCH.md`.

## Setup

```bash
# from repo root
npm run mcp:install
npm run mcp:start
```

Node ≥ 20.

## Environment

| Env | Default | Meaning |
|-----|---------|---------|
| `IC2_MCP_ALLOW_WRITE` | **allow** (unset) | Set `0` to force read-only |
| `IC2_MCP_BOARD_PATH` | — | Optional auto-open file session |

## Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.ic2]
command = "npx"
args = [
  "--prefix", "C:/Users/…/InfiniteCanvas2/packages/ic2-mcp",
  "tsx",
  "C:/Users/…/InfiniteCanvas2/packages/ic2-mcp/src/index.ts",
]
startup_timeout_sec = 120

[mcp_servers.ic2.env]
IC2_MCP_ALLOW_WRITE = "1"
```

1. Start **Infinite Canvas 2**  
2. Restart Codex  
3. `/mcp` → see `ic2`  
4. Prompt brand research (see `docs/CODEX_BRAND_RESEARCH.md`)

## Tools

| Tool | Notes |
|------|--------|
| `ic2_status` | live vs file |
| `ic2_board_open` / `info` / `save` | file session |
| `ic2_get_viewport` | place in view |
| `ic2_tree` / `list_items` / `get_item` / `get_stack` / `export_text` / `search` | read |
| `ic2_create_note` | notes; set `role=title\|keyword` for large floating type |
| `ic2_create_text` | free-floating title/keyword (kind=text) |
| `ic2_create_link` | **pages only** — not image asset URLs |
| `ic2_import_image_url` | real media on canvas |
| `ic2_create_stack` / `rename_stack` / `move_to_container` | structure |
| `ic2_layout_grid` | arrange |
| **`ic2_add_research_cluster`** | create or **append** mood board (`stackId` / same `clientRequestId`) |
| **`ic2_append_cluster`** | progressive chunk: one section at a time into existing stack |

`containerId`: use `root` for home.

### Free canvas / mood board (agents)

1. Photos → `images[]` or `import_image_url` (never `links` for `.jpg`/`.png`).  
2. Titles/keywords → `role: title|keyword` with **bold `fontSize`** (defaults are large; scale by importance).  
3. Paragraphs → `role: body` / default note (auto height).  
4. After cluster: `createdStackIds[0]` + `list_items` (not `get_item` on stack id).  

Generic skill: `skills/ic2-moodboard` (any topic — not brand-only).

## Architecture

```
packages/ic2-mcp
  liveClient.ts  →  %LOCALAPPDATA%/InfiniteCanvas/agent/
  backend.ts     →  live || file session
  tools.ts       →  MCP surface
src/board-ops    →  pure domain + dispatch
src/hooks/useAgentBridge.ts  →  App poller
```
