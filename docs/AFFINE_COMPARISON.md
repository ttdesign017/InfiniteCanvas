# Infinite Canvas 2 × AFFiNE — 架构对比与可借鉴点

| 字段 | 内容 |
|------|------|
| **文档类型** | 外部仓库对照分析（Architecture Comparison & Borrowing Guide） |
| **对照仓库** | [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) |
| **对照分支 / 版本线索** | `canary` · monorepo `@affine/monorepo` ~0.27.x |
| **本仓库** | Infinite Canvas 2（IC2） |
| **数据时点** | 2026-07-24 |
| **方法** | 公开仓库结构、README、package 布局、CI 工作流与存储文档对照 IC2 源码 |
| **相关文档** | `CODEBASE_MATURITY_ASSESSMENT.md` · `SIMILAR_PROJECTS.md` |

---

## 1. 执行摘要

### 1.1 核心结论

1. **产品赛道不同。** AFFiNE 是 Notion + Miro 取向的知识库操作系统；IC2 是 PureRef 取向的媒体参考板 + 嵌套栈 + 本地工程 + Agent/MCP。不宜整仓移植或改用 BlockSuite 重写。
2. **最有价值的借鉴在「存储边界、重活下沉、工程交付、画布子系统切分」**，而非 CRDT 协作、自托管后端或 monorepo 全套。
3. **对 IC2 当前瓶颈命中最高的一招：** AFFiNE `nbstore` 的 **Doc / Blob 分离**——对照 IC2 将媒体 base64 打进单一 `.icanvas` JSON 的做法。
4. **IC2 相对 AFFiNE 的独特优势：** `board-ops` + MCP / Agent 桥。应继续产品化（权限、稳定协议），而不是用 AFFiNE AI 叙事替代。

### 1.2 若只做三件事（务实路线）

结合「Windows 正式 1.0」目标，优先：

| 优先级 | 动作 | 学自 AFFiNE 的哪一层 |
|--------|------|----------------------|
| 1 | **存储格式演进：Doc 与媒体分离** | `nbstore` 边界（不学 CRDT） |
| 2 | **发版流水线：CI 构建 + Release（+ 签章规划）** | `release-desktop.yml` 骨架 |
| 3 | **主路径 E2E + 轻量 lint** | `tests/*` + oxlint/ESLint/Prettier 纪律（缩到 IC2 体量） |

---

## 2. 产品与定位对照

| 维度 | AFFiNE | IC2 |
|------|--------|-----|
| 定位 | 开源、local-first 的 Notion & Miro 替代；文档 / 白板 / 表 / AI / 协作 | PureRef 启发的无限画布参考板；媒体摆放、嵌套栈、本地工程 |
| 用户场景 | 知识管理、规划、演示、协同白板 | 灵感板、分镜参考、多媒体 moodboard |
| 数据主权 | Local-first + 可选云同步与实时协作 | 单机本地文件为主 |
| 编辑内核 | BlockSuite（block + CRDT） | 自研画布 + Zustand snapshot |
| 桌面壳 | Electron（Web / Desktop / Mobile） | Tauri 2（偏 Windows） |
| 扩展 / 自动化 | 插件生态规划、AI 产品能力 | `board-ops` + MCP + Agent 文件桥 |
| 仓库规模 | monorepo、万级 commits、完整发布矩阵 | 单应用 + `packages/ic2-mcp` |

**原则：** 借鉴 **工程与存储模式**，不借鉴 **产品边界扩张**（除非商业路线图明确要求知识库 / 协作）。

---

## 3. 架构对照

### 3.1 AFFiNE 结构（与 IC2 相关部分）

```text
AFFiNE monorepo
├── blocksuite/                 # 编辑器引擎（与 app 解耦）
│   ├── framework/              # store / sync / std（Yjs 系状态）
│   └── affine/
│       ├── gfx/                # 无限画布：brush / shape / group / mindmap / turbo-renderer
│       ├── blocks/             # 文档块
│       └── model/
├── packages/
│   ├── common/nbstore/         # Doc 与 Blob 分离存储（IDB / SQLite / Cloud）
│   ├── common/infra/           # 基础设施抽象
│   ├── frontend/native/        # NAPI-RS 原生（SQLite、nbstore 等）
│   ├── frontend/i18n/          # 独立 i18n 包 + codegen
│   ├── frontend/apps/          # web / electron / mobile / …
│   └── backend/                # 自托管与云
└── tests/                      # Playwright 多场景 E2E
```

### 3.2 IC2 结构

```text
Infinite Canvas 2
├── src/types + store/          # 领域模型 + Zustand（轻量 store，无 CRDT）
├── src/components + hooks/     # 画布 UI / 手势（DOM 实现）
├── src/utils/boardFile         # 文档 + base64 媒体一体
├── src/board-ops               # 读写契约、错误码
├── packages/ic2-mcp            # Agent 工具面
└── src-tauri/                  # 薄原生（预览 / IO / SSRF 防护）
```

### 3.3 概念映射

| AFFiNE | IC2 近似对应 | 差异 |
|--------|--------------|------|
| BlockSuite store | `useCanvasStore` + history | 无 CRDT；snapshot + undo |
| `gfx/*` | `InfiniteCanvas` + pointer hooks + item views | DOM 画布 vs 引擎化 gfx 包 |
| `nbstore` Doc | `ICanvasDocument` 结构字段 | IC2 结构与媒体未分离 |
| `nbstore` Blob | `assets` 内 base64 | IC2 内嵌 JSON，扩展性差 |
| Electron app shell | Tauri `src-tauri` | 更轻，发布矩阵更弱 |
| 云 / realtime | （无） | IC2 不追求协作时可忽略 |
| AI 产品面 | MCP / Agent bridge | 可编程写板是 IC2 差异化 |

---

## 4. 分域对比与可借鉴点

### 4.1 存储与文档格式 — **最高 ROI**

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 文档状态 | CRDT / 二进制 doc 更新 | JSON snapshot + `formatVersion` |
| 大对象 | **独立 Blob storage**（IDB / SQLite） | **base64 写入同一 JSON** |
| 线程模型 | 可将 storage 放到 **Worker** | pack/save 主要在主路径 |
| 桌面持久化 | Native SQLite 等 | 文件读写 + 内嵌资产 |

AFFiNE `nbstore` 用法示意（概念）：

- `IndexedDBDocStorage` / `SqliteBlobStorage` 可组合进 `SpaceStorage`
- Doc 与 Blob 生命周期分离
- Worker client 避免阻塞 UI

IC2 现状要点（`src/utils/boardFile.ts`）：

- `ICANVAS_FORMAT_VERSION`、magic、完整性校验已具备  
- `ICANVAS_MAX_TEXT_BYTES`（~512MiB）硬顶反映 **单体 JSON 风险**  
- 大板子常落在 200–400MB 量级（媒体内嵌）

**建议落地（学边界，不学 CRDT）：**

| 方向 | 形态 |
|------|------|
| 逻辑分离 | 结构文档只存 `assetId`；媒体为二进制 blob |
| 物理形态 | 目录包，或 zip 容器式 `.icanvas`（内层非 base64 文本） |
| 运行时 | `assetId` → blob URL；打开时物化，关闭时 revoke |
| 进阶 | content-addressed 本地 store / SQLite blob 表 |

### 4.2 保存与重 IO

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 队列 / 合并 | 存储层 + 连接状态反馈 | `SaveQueue` 合并突发保存（已有） |
| 重计算位置 | Worker / Native | 前端 pack + base64 |
| 进度 / 状态 | connection status 可绑 UI | toast + dirty；大文件进度弱 |

**建议：**

- pack/unpack 进 Web Worker，或 Tauri 侧 **流式写盘**  
- 大媒体走二进制路径，避免整文件文本化  
- 长保存增加可取消 / 进度指示（产品层）

### 4.3 画布与渲染

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 模块 | `gfx/` 按 brush、shape、group、pointer、turbo-renderer 分包 | 手势 / 栈 / 媒体多集中在大 hooks 与大组件 |
| 大规模场景 | `turbo-renderer` 等专项优化 | viewport cull、视频 poster、pack 并发等 |
| 组织语义 | group 等 | **嵌套栈**（enterable container，语义更强） |

**建议：**

- 保持栈模型；不必换成 block/group 通用模型  
- 按能力切模块：pointer / selection / stack chrome / media / scribble  
- 超大场景再评估 Canvas/WebGL；短期继续强化 cull 与媒体解码策略  

### 4.4 状态与协作

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 状态 | Yjs / y-octo / 同步层 | Zustand + history/future |
| 协作 | 一等公民 | 非目标 |

**建议：不引入 CRDT。** 单机参考板冲突收益低、成本高。若未来有「多端只读同步」，再评估轻量同步，而非全量 CRDT。

### 4.5 桌面壳与原生

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 壳 | Electron 多端 | Tauri 2 |
| 原生重能力 | NAPI-RS（`@affine/native`） | 少量 `#[tauri::command]`（预览、代理、启动路径等） |
| 安全 | 云与桌面综合面 | link preview **SSRF 防护**、CSP、asset scope |

**建议：**

- **保留 Tauri**（贴合轻量桌面）  
- 仅在媒体索引 / 大文件 IO 成为瓶颈时，考虑 Rust 侧重能力扩展  
- 安全侧 IC2 已有亮点，继续保持最小权限叙事  

### 4.6 工程门禁与测试

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| Lint | oxlint + ESLint + Prettier + husky | 几乎无项目级 lint |
| 单元测试 | Vitest | Vitest 强（领域回归） |
| E2E | Playwright 多场景（local/desktop/cloud/mobile） | 基本无 |
| CI | build-test + 多 release 工作流 | `check`（typecheck + test + mcp） |

**建议最小集：**

```text
oxlint 或 ESLint + Prettier
→ pre-commit: lint + typecheck
→ CI: check + 1 条 Playwright smoke
→ 正式版: build Windows 产物
```

建议 smoke 路径：

> 打开板 → 导入媒体 → 保存 → 再开 → 进栈 / 退栈 → 关闭未保存提示  

### 4.7 发布与更新

AFFiNE `release-desktop.yml` 要点：

- macOS / Windows / Linux 矩阵  
- Windows / Apple **代码签名**  
- 产物上传、GitHub Release  
- 自动更新配置痕迹（如 `dev-app-update.yml`）  
- Sentry 注入  

IC2：本地 portable / nsis·msi 目标有；可重复 CI 发版、签章、更新通道弱。

**建议缩小版流水线：**

```text
check → build Windows (nsis / msi / portable)
     → (可选) 代码签名
     → GitHub Release + 版本说明
     → (可选) 更新 yml / 应用内「检查更新」
```

### 4.8 国际化、模板、可观测

| 项 | AFFiNE | IC2 | 建议 |
|----|--------|-----|------|
| i18n | 独立包 + codegen | 无 | 需要中英时上最小 key 表 |
| Templates | 增长飞轮 | 无 | 中期：内置 moodboard 模板 |
| 崩溃上报 | Sentry | 本地 diag + ErrorBoundary | 正式版可选匿名上报；强化一键导出诊断 |
| 错误模型 | 独立 error 包等 | `BoardOpsError` 已结构化 | 保持；UI 映射可再统一 |

### 4.9 Agent / AI

| 项 | AFFiNE | IC2 |
|----|--------|-----|
| 方向 | 产品内 AI 伴侣、生成与整理 | 外部 Agent 经 MCP / 文件桥操作画板 |
| 成熟点 | 产品与云能力 | 协议、dispatch、幂等 claim、错误码 |

**建议：** 把 Agent 写权限默认安全、稳定协议版本、审计日志当作正式版差异化，而不是追 AFFiNE 的应用内 AI 形态。

---

## 5. 建议采纳 / 明确不采纳

### 5.1 建议采纳（按优先级）

#### P0 — 命中 IC2 瓶颈

| ID | 借鉴点 | 落地要点 |
|----|--------|----------|
| P0-1 | Doc / Blob 分离 | `.icanvas` 演进：结构与媒体分存；去掉大 base64 JSON |
| P0-2 | 重 IO 离主线程 | Worker 或 Tauri 流式 pack/unpack |
| P0-3 | 可重复桌面发版 | CI 构建 + Release；（规划）签章 |
| P0-4 | 主路径 E2E | Playwright 一条 local smoke |

#### P1 — 工程纪律与可维护性

| ID | 借鉴点 | 落地要点 |
|----|--------|----------|
| P1-1 | 引擎 / 壳分层 | domain → canvas engine → React → Tauri |
| P1-2 | gfx 式能力分包 | 拆 pointer / stack / media / scribble 热点文件 |
| P1-3 | Lint + format + husky | 轻量配置即可 |
| P1-4 | 可观测 | 诊断导出产品化；可选 Sentry |
| P1-5 | i18n 结构 | 需要时独立文案层 |

#### P2 — 产品增长（路线图可选）

| ID | 借鉴点 | 落地要点 |
|----|--------|----------|
| P2-1 | Templates | 内置参考板 / 分镜模板 |
| P2-2 | 多平台矩阵 | macOS（及可选 Linux）与更新通道 |
| P2-3 | 连接状态 UX | 保存 / 打开 / Agent 会话状态可视化 |

### 5.2 明确不建议照搬

| 项 | 原因 |
|----|------|
| 整仓 monorepo + Yarn 4 工作区 | IC2 体量撑不起运维成本 |
| 全面 Yjs / CRDT | 单机媒体板冲突收益低、复杂度极高 |
| 用 BlockSuite 重写画布 | 产品语义是 media board，不是 block editor |
| Electron 替换 Tauri | 无强需求；Tauri 更贴合轻量桌面 |
| 云协作 / 账号 / 自托管后端 | 偏离差异化，除非商业明确要求 |
| Capacitor 移动端优先 | 非参考板核心路径 |

---

## 6. 现状 → 启发 → 动作总表

| 领域 | IC2 现状 | AFFiNE 做法 | 建议动作 |
|------|----------|-------------|---------|
| 媒体存储 | base64 进 JSON | Doc/Blob 分离 + SQLite/IDB | 设计 `.icanvas` 外置/分片 blob |
| 保存性能 | 前端 pack + SaveQueue | Worker + native | pack 下沉 Worker/Rust 流式写 |
| 状态模型 | Zustand snapshot + history | CRDT store | **保持** snapshot；history 已够用 |
| 画布渲染 | React DOM + cull | gfx + turbo-renderer | 继续 cull；模块化；慎上 WebGL |
| 模块边界 | 部分巨型 hooks | 引擎 / 块 / 应用分层 | 拆 pointer / stack / media |
| 测试 | 单测强 | 单测 + E2E 矩阵 | 加 1 条 Playwright 冒烟 |
| 质量门禁 | tsc + vitest | lint + prettier + husky | 加轻量 lint |
| 发版 | 本地 portable | 签章 + 多平台 + 更新 yml | Windows 可重复 Release |
| 国际化 | 无 | i18n 包 | 需要时再上 |
| Agent | MCP + board-ops | 应用内 AI（不同） | **保持优势**，权限模型产品化 |
| 崩溃 | 本地 diag | Sentry | 可选远程；强化本地导出 |

---

## 7. 与 IC2 正式版路线的衔接

与 `CODEBASE_MATURITY_ASSESSMENT.md` 中的里程碑对齐：

| 正式版缺口 | AFFiNE 对照启发 |
|------------|-----------------|
| 大文件 / OOM | Doc/Blob 分离 + 流式 IO |
| 发版可信度 | release-desktop 矩阵与签章流程（缩小版） |
| 主路径回归 | Playwright local/desktop 分层思路 |
| 工程门禁 | lint + husky + 覆盖率可选 |
| 产品壳 | i18n / 设置 / 模板（P1–P2） |
| Agent 安全 | AFFiNE 无直接对等；IC2 自建权限模型 | 

```text
Windows 正式 1.0（建议）
  = 现有产品内核
  + Doc/Blob 存储演进（或至少减负路径）
  + 可重复发版（+ 签章规划）
  + 主路径 E2E
  + Agent 写权限默认安全
```

跨平台、云协作、BlockSuite 级编辑器 **不应** 阻塞该里程碑。

---

## 8. 一句话总结

> AFFiNE 是「知识库级操作系统」的工业样板；IC2 是「媒体参考板 + 可编程画布」的垂直工具。  
> **该学的是：blob 与文档分离、重活离主线程、发布/签章/E2E/工程门禁、画布子系统切分。**  
> **不该学的是：整仓架构、CRDT 协作、BlockSuite 重写、云与自托管全套。**  
> **该守住的是：嵌套栈语义、本地工程体验、以及 MCP/Agent 可编程写板。**

---

## 9. 附录

### 9.1 关键公开路径（AFFiNE）

| 区域 | 路径 |
|------|------|
| 仓库根 | https://github.com/toeverything/AFFiNE |
| 编辑引擎 | `blocksuite/framework` · `blocksuite/affine` |
| 画布 gfx | `blocksuite/affine/gfx`（含 `turbo-renderer`） |
| 存储 | `packages/common/nbstore` |
| 原生 | `packages/frontend/native` |
| 桌面 | `packages/frontend/apps/electron` |
| i18n | `packages/frontend/i18n` |
| E2E | `tests/affine-local` 等 |
| 桌面发版 | `.github/workflows/release-desktop.yml` |

### 9.2 关键本地路径（IC2）

| 区域 | 路径 |
|------|------|
| 文件格式 | `src/utils/boardFile.ts` |
| 保存队列 | `src/utils/saveQueue.ts` |
| 状态 | `src/store/useCanvasStore.ts` |
| 领域契约 | `src/board-ops/` |
| Agent | `src/hooks/useAgentBridge.ts` · `packages/ic2-mcp/` |
| 桌面 | `src-tauri/` |
| CI | `.github/workflows/check.yml` |

### 9.3 后续可选产出

| 产出 | 说明 |
|------|------|
| `.icanvas` vNext 设计草案 | Doc/Blob 分离、迁移与兼容策略 |
| 发版 workflow 草案 | Windows-only 缩小版 CI |
| Playwright smoke 清单 | 与 `QA_CHECKLIST` 对齐的自动化子集 |

### 9.4 文档维护

| 项 | 说明 |
|----|------|
| 适用场景 | 架构决策、存储演进立项、避免错误对标 AFFiNE 全量能力 |
| 更新建议 | AFFiNE 大版本或 IC2 存储/发版策略变更时复评 |
| 方法约束 | 以公开代码与流水线事实为准；不替代完整竞品商务分析 |

---

*本文件基于 AFFiNE 公开仓库与 IC2 源码对照生成。AFFiNE 内部未公开实现细节可能与 canary 快照存在偏差；落地前应对拟借鉴模块做针对性精读。*
