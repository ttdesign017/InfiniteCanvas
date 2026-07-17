# Infinite Canvas 2 — MCP 契约与路线

> **状态：** 领域层（board-ops）已落地；MCP Server 包尚未实现。  
> **对齐产品：** `PRODUCT.md` §5（本地 · 重媒体 · 强空间 · Agent 可读写）  
> **领域实现：** `src/board-ops/` · 说明 `docs/BOARD_OPS.md`  
> **API version：** `BOARD_OPS_API_VERSION = 1`

---

## 1. 目标

把 IC2 板暴露为 **外部 Agent 可调用的 Board API**（MCP Tools / Resources），而不是板内 Chat。

| 要 | 不要 |
|----|------|
| 读树 / 列表 / 导出文本 / 受限写笔记 | 默认 dump 全板媒体 base64 |
| 与 UI 共用 `board-ops` | MCP 直接碰 React / 手势 / Zustand 内部 |
| 错误码稳定、可 Undo 的写入语义 | 无确认批量删除、自动打乱布局 |
| 先文件模式，后 live 会话 | 一上来做协作与云账号 |

---

## 2. 架构

```
Agent (Claude Desktop / Cursor / …)
        │ MCP stdio (planned)
        ▼
packages/ic2-mcp/          ← 未实现：协议适配 only
        │
        ▼
src/board-ops/             ← 已实现：纯领域 + 文件 I/O
        │
        ├─► 文件: load/save .icanvas
        └─► 实时: (planned) App bridge → store actions + pushHistory×1
```

**铁律：** MCP tool handler 只调用 `board-ops`（及将来的 live adapter），禁止复制一份业务逻辑。

---

## 3. 运行模式

### 3.1 文件模式（首期 MCP）

1. Tool: 打开/绑定 path  
2. `loadBoardViewFromPath` → 内存 `BoardView`  
3. 只读 / 受限写 → `saveBoardViewToPath`  
4. 用户用 App 打开同一文件查看  

### 3.2 实时模式（后续）

- App 本地 loopback + session token  
- `get_selection` / `navigate` / 写操作进 `pushHistory` + dirty  
- 不在 v1 board-ops 范围内  

---

## 4. 建议的 MCP Tools 映射（v1）

命名前缀 `ic2_`。参数与 `board-ops` 对齐。

### 4.1 会话 / 文件

| Tool | board-ops | 说明 |
|------|-----------|------|
| `ic2_board_open` | `loadBoardViewFromPath` | 绑定工作板；server 内存持有 `BoardView` |
| `ic2_board_info` | `getBoardMeta` | 名称、数量、apiVersion |
| `ic2_board_save` | `saveBoardViewToPath` | 写回 path；需写权限 |

### 4.2 只读

| Tool | board-ops | 关键参数 |
|------|-----------|----------|
| `ic2_tree` | `buildStackTree` | `containerId?` default `root`, `depth?` |
| `ic2_list_items` | `listItems` | **`containerId` 必填**, `type?`, `limit?` |
| `ic2_get_item` | `getItem` | `id` |
| `ic2_export_text` | `exportText` | `containerId`, `ids?` |
| `ic2_search` | `searchItems` | `query`, `containerId?` |

### 4.3 受限写（需配置允许 write）

| Tool | board-ops | 说明 |
|------|-----------|------|
| `ic2_create_note` | `createNote` | `dry_run?`, `client_request_id?` |
| `ic2_create_notes` | `createNotesBatch` | 一批 = 一逻辑变更 |
| `ic2_update_text` | `updateText` | 白名单字段 |
| `ic2_move_items` | `moveItems` | 绝对坐标 |

### 4.4 默认不做（v1 tools）

- `delete_*` 无确认  
- `layout_apply` 无 suggest 步骤  
- `get_media_base64`  
- stack enter 动画控制  

---

## 5. 资源与提示（可选后续）

**Resources**

- `icanvas://session/tree` — 当前绑定板的树 JSON  
- `icanvas://session/item/{id}` — 单项 DTO  

**Prompts**

- `summarize_container` — 先 `export_text` 再总结的话术模板  

---

## 6. 安全

| 风险 | 对策 |
|------|------|
| 路径穿越 | allowlist / 用户显式 path；禁止任意 `**` |
| 大文件 | `ICANVAS_MAX_TEXT_BYTES`；list `limit` 默认 100 |
| 隐私 | 本地进程；DTO 无媒体字节 |
| 破坏布局 | 写默认关；`dry_run`；无自动全板重排 |
| 写权限 | MCP server 配置 `allowWrite: false` 默认 |

错误返回 JSON：

```json
{ "code": "ITEM_NOT_FOUND", "message": "Item not found: …", "detail": "…" }
```

（`boardErrorToJson`）

---

## 7. Agent 使用约定

1. **先 `ic2_board_info` / `ic2_tree`，再 list** — 禁止一上来无 limit 全量 items。  
2. **`containerId` 显式** — `root` 或 stack id；不要猜「当前文件夹」。  
3. **坐标** — 世界坐标，在所属 container 内。  
4. **写之前 `dry_run: true`**（若工具支持）确认数量与位置。  
5. **一批笔记用 `ic2_create_notes`**，便于以后 live 一次 Undo。  

示例流程：

```
ic2_board_open({ path })
→ ic2_tree({ containerId: "root", depth: 2 })
→ ic2_export_text({ containerId: "root" })
→ ic2_create_note({ containerId: "root", x, y, content, dry_run: true })
→ ic2_create_note({ … })
→ ic2_board_save()
```

---

## 8. 实现状态

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 0 board-ops 只读 + DTO + 错误 | **Done** | `src/board-ops` |
| Phase 0.5 受限写 + 文件 API 解耦 UI | **Done** | `write.ts`, `fileOps.ts`, `boardIO` 薄封装 |
| Phase 1 MCP stdio server 骨架 | **Done** | `packages/ic2-mcp` |
| Phase 2 扩展写入 + 布局 + research cluster | **Done** | link / image / stack / layout / `add_research_cluster` |
| Phase 3 Live bridge | **Done** | App `useAgentBridge` + MCP `liveClient`（见 `AGENT_BRIDGE.md`） |
| Phase 4 路径 allowlist / UI 授权开关 | **Todo** | 产品加固 |

---

## 9. 工程检查清单

- [x] `packages/ic2-mcp` + `@modelcontextprotocol/sdk`  
- [x] 进程内 session：`snapshot` + path + dirty  
- [x] tool 错误 → `boardErrorToJson`  
- [x] README：Claude Desktop / Cursor 配置示例  
- [x] 默认写权限可开（`IC2_MCP_ALLOW_WRITE`，未设置时默认允许）  
- [x] CI：`npm run check` 含 board-ops 单测  
- [x] Live bridge 文件收件箱  
- [ ] 宿主侧真实 Agent 联调（品牌调研端到端）  
- [ ] 路径 allowlist / App 内「允许 Agent」开关  

### 本地启动

```bash
npm run mcp:install
npm run mcp:start
# 或
cd packages/ic2-mcp && npm start
```

环境变量：`IC2_MCP_ALLOW_WRITE`、`IC2_MCP_BOARD_PATH`（见 `packages/ic2-mcp/README.md`）。

---

## 10. 相关文档

| 文档 | 内容 |
|------|------|
| `docs/BOARD_OPS.md` | 领域 API 详解 |
| `docs/PRODUCT.md` | AI/MCP 产品原则 |
| `docs/ENGINEERING_PRODUCTIZATION.md` | 工程化门槛 |
| `docs/PERF_BASELINE.md` | 性能（I/O 与 MCP 无关但共享 file 路径） |
