# Infinite Canvas 2 — GitHub 相似项目调研

| 字段 | 内容 |
|------|------|
| **文档类型** | 竞品 / 相似开源项目调研（Landscape Scan） |
| **对照产品** | Infinite Canvas 2（IC2） |
| **IC2 产品特征** | 桌面端无限画布 · 媒体参考 / 灵感板 · 嵌套栈 · 本地工程文件（`.icanvas`）· Agent / MCP |
| **数据时点** | 2026-07-24 |
| **数据来源** | GitHub Topics、Repository Search API、仓库元数据（`stargazers_count`） |
| **说明** | Star 为快照，会随时间变化；排序原则为 **先相关度、后 Star** |

---

## 1. 执行摘要

### 1.1 核心发现

1. **「PureRef 式参考图板」开源赛道小而散。** 高相关仓库 Star 多在百级～千级（标杆 [BeeRef](https://github.com/rbreu/beeref) ≈ 778），没有出现类似 Excalidraw 量级的超级明星。
2. **高 Star 项目多为白板 / 知识画布，而非媒体参考板。** Excalidraw、tldraw、AFFiNE 解决协作白板与知识组织；与 IC2 的「媒体摆放 + 本地工程 + 栈嵌套」产品线不同。
3. **IC2 的组合能力在开源侧仍属稀缺。** 同时具备「桌面 + 多媒体参考 + 嵌套组织 + 本地打包文件 + Agent 读写」的公开项目几乎没有同档位直接对手。

### 1.2 对标三角（建议持续跟踪）

| 维度 | 代表项目 | 说明 |
|------|----------|------|
| 场景（参考图板） | BeeRef、AnimRef、DroidRef | 与 PureRef 使用场景重合度最高 |
| 桌面无限画布体验 | Lorien、Butterfly、rnote | 跨平台桌面 App，交互形态接近 |
| 可编程 / Agent | OpenCove、termcanvas 及 MCP 生态 | 对应 IC2 的 Agent / MCP 差异化 |

### 1.3 不纳入开源主表的闭源对标

| 产品 | 说明 |
|------|------|
| **[PureRef](https://www.pureref.com/)** | IC2 核心商业对标（参考图 / moodboard 桌面工具）；闭源，无 GitHub 主仓 |

---

## 2. 检索与评分方法

### 2.1 检索入口

| 入口 | 用途 |
|------|------|
| [`github.com/topics/infinite-canvas`](https://github.com/topics/infinite-canvas) | 无限画布专题（约 143 个公开仓库） |
| GitHub Search：`PureRef in:readme,description` | PureRef 提及与替代实现 |
| GitHub Search：`reference image viewer` / `moodboard canvas` | 参考图板 / moodboard 长尾 |
| 人工 curated 列表 | 白板 SDK、知识画布、Agent 画布等相邻品类 |

### 2.2 相关度定义（相对 IC2）

| 等级 | 符号 | 判定标准 |
|------|:----:|----------|
| 高 | ★★★★★ / ★★★★☆ | PureRef 式参考图板、moodboard、桌面媒体摆放 |
| 中 | ★★★☆☆ | 无限画布手绘 / 白板 / 笔记画布（非以媒体参考为主） |
| 弱 | ★★☆☆☆ / ★☆☆☆☆ | 画布 SDK、节点编辑、Agent 工作区画布等（形态不同） |

### 2.3 排序规则

1. **主排序：相关度**（高 → 中 → 弱）  
2. **次排序：GitHub Stars**（高 → 低）  
3. 列表内「综合排序」表综合二者，优先列出最值得 IC2 跟踪的仓库  

---

## 3. A 组 — 高相关：参考图板 / PureRef 类

按 **Stars 降序**。

| Stars | 仓库 | 形态 | 相关度 | 说明 |
|------:|------|------|:------:|------|
| **778** | [rbreu/beeref](https://github.com/rbreu/beeref) | Python / PyQt6 桌面 | ★★★★★ | 社区公认的 **开源 PureRef 替代**；参考图摆放与查看，交互极简 |
| **114** | [lettucegoblin/AnimRef](https://github.com/lettucegoblin/AnimRef) | 桌面 | ★★★★★ | 明确写成 PureRef remake；支持 **GIF / 视频 / YouTube**（媒体面更接近 IC2） |
| **114** | [Ruin0x11/DroidRef](https://github.com/Ruin0x11/DroidRef) | Android / Kotlin | ★★★★☆ | 移动端参考图板（PureRef / VizRef 类）；平台不同但场景一致 |
| **~28** | [rgrams/multiviewer](https://github.com/rgrams/multiviewer) | Defold | ★★★☆☆ | 多图参考查看器，功能较轻 |
| **6** | [rieszedit/refboard](https://github.com/rieszedit/refboard) | TypeScript | ★★★★☆ | 独立无限画布参考管理；产品叙事接近，体量很小 |

### 3.1 本组结论

- 真正「PureRef 开源对标」项目 **Star 普遍不高**，BeeRef 是其中标杆。  
- **IC2 在「桌面 + 多媒体 + 嵌套组织 + Agent」上的组合，开源侧几乎没有同档位直接对手。**

---

## 4. B 组 — 中高相关：无限画布应用

按 **Stars 降序**。

| Stars | 仓库 | 形态 | 相关度 | 说明 |
|------:|------|------|:------:|------|
| **128k** | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | Web 白板 | ★★★☆☆ | 手绘白板标杆；偏 diagram，**非媒体参考板** |
| **70.7k** | [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 知识库 + 画布 | ★★★☆☆ | Notion / Miro 取向；无限画布 + 文档，协作 / 知识为主 |
| **49.2k** | [tldraw/tldraw](https://github.com/tldraw/tldraw) | React 无限画布 SDK + 应用 | ★★★☆☆ | 工业级 canvas SDK；可做 moodboard，默认是白板引擎 |
| **14.3k** | [plait-board/drawnix](https://github.com/plait-board/drawnix) | 一体化白板 | ★★★☆☆ | 思维导图 / 流程图 / 手绘一体 |
| **11.5k** | [flxzt/rnote](https://github.com/flxzt/rnote) | Rust / GTK 手写笔记 | ★★★★☆ | **桌面无限画布手写**；偏笔迹 PDF，非媒体板 |
| **6.7k** | [mbrlabs/Lorien](https://github.com/mbrlabs/Lorien) | Godot 跨平台 | ★★★★☆ | 无限画布白板；轻量、矢量笔迹；**最接近「桌面无限画布 App」之一** |
| **3.6k** | [obsidianmd/jsoncanvas](https://github.com/obsidianmd/jsoncanvas) | 开放格式 | ★★☆☆☆ | `.canvas` 规范；Obsidian 画布生态，非完整应用 |
| **1.9k** | [LinwoodDev/Butterfly](https://github.com/LinwoodDev/Butterfly) | Flutter 跨平台笔记 | ★★★★☆ | 无限画布笔记；社区有人当 **参考板 / 替代 PureRef** 使用 |
| **1.9k** | [serge-rgb/milton](https://github.com/serge-rgb/milton) | C++ 绘画 | ★★★☆☆ | 无限画布绘画；偏 paint，维护偏旧 |
| **1.5k** | [DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove) | Electron / TypeScript | ★★★☆☆ | Agent / 任务 / 知识无限画布；与 IC2 的 **Agent 面** 相邻 |
| **448** | [ErrorAtLine0/infinipaint](https://github.com/ErrorAtLine0/infinipaint) | C++ 协作 | ★★★☆☆ | 无限缩放协作涂鸦 / 笔记 |

---

## 5. C 组 — 引擎 / SDK / 弱相关

按 **Stars 降序**，供技术对标与实现参考。

| Stars | 仓库 | 相关度 | 说明 |
|------:|------|:------:|------|
| **37.8k** | [xyflow/xyflow](https://github.com/xyflow/xyflow) | ★★☆☆☆ | React / Svelte 节点图（React Flow），非参考板 |
| **31.3k** | [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | ★★☆☆☆ | Canvas 对象模型库，可搭 moodboard |
| **4.3k** | [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | ★★★☆☆ | 国产无限画布引擎（交互 / 编辑） |
| **2.0k** | [miroiu/nodify](https://github.com/miroiu/nodify) | ★★☆☆☆ | WPF 节点编辑器控件 |
| **1.5k** | [malbiruk/driftwm](https://github.com/malbiruk/driftwm) | ★☆☆☆☆ | 无限画布 Wayland 合成器（窗口管理隐喻） |
| **1.1k** | [xiaoiver/infinite-canvas-tutorial](https://github.com/xiaoiver/infinite-canvas-tutorial) | ★★★☆☆ | 无限画布教程 / 实现参考（WebGL / WebGPU） |
| **372** | [blueberrycongee/termcanvas](https://github.com/blueberrycongee/termcanvas) | ★★☆☆☆ | 终端可视化画布 + MCP（Agent 工具链相邻） |

**专题入口：** [github.com/topics/infinite-canvas](https://github.com/topics/infinite-canvas)

---

## 6. 综合排序（先相关度，后 Star）

更适合作为 **IC2 竞品 / 参照系** 的跟踪顺序：

| 排序 | 项目 | Stars | 为何排这里 |
|-----:|------|------:|------------|
| 1 | **BeeRef** | 778 | 场景重合最高的开源 PureRef 替代 |
| 2 | **AnimRef** | 114 | PureRef remake + 视频 / GIF / YouTube |
| 3 | **DroidRef** | 114 | 同场景，移动端 |
| 4 | **Lorien** | 6.7k | 桌面无限画布 App，技术 / 产品形态近 |
| 5 | **Butterfly** | 1.9k | 跨平台笔记画布，可当参考板 |
| 6 | **rnote** | 11.5k | 桌面无限画布，手写向 |
| 7 | **milton / infinipaint** | 1.9k / 448 | 无限画布绘画 / 协作 |
| 8 | **tldraw / Excalidraw / AFFiNE** | 49k / 128k / 71k | Star 高、生态大，但默认场景是白板 / 知识而非参考媒体板 |
| 9 | **OpenCove / termcanvas** | 1.5k / 372 | Agent + 画布，对应 IC2 的 MCP / Agent 差异化 |
| 10 | **leafer-ui / infinite-canvas-tutorial** | 4.3k / 1.1k | 引擎与实现教材 |

---

## 7. 竞争格局解读

### 7.1 赛道结构

```text
                    高 Star
                       │
     白板 / 知识画布   │   Excalidraw · tldraw · AFFiNE
     （生态成熟）      │
                       │
     ──────────────────┼──────────────────  相关度 →
                       │
     参考图板 / PureRef│   BeeRef · AnimRef · DroidRef
     （开源稀疏）      │         ↑ IC2 更靠近这里，并叠加
                       │           嵌套栈 + 本地工程 + Agent
                    低 Star
```

### 7.2 对 IC2 的含义

| 观察 | 含义 |
|------|------|
| 参考图板开源 Star 不高 | 市场存在，但社区心智仍被 PureRef 占据；开源替代未形成「默认选择」 |
| 高 Star 是白板 / 知识 | 对外叙事需区分：**媒体参考板** ≠ **协作白板**，避免被错误归类 |
| 桌面无限画布有成熟范例 | Lorien / rnote / Butterfly 可作 **交互与打包** 参考，而非场景照搬 |
| Agent + 画布是新方向 | OpenCove 等说明「画布作为 Agent 工作面」正在兴起；IC2 的 MCP 是差异化筹码 |

### 7.3 IC2 相对空白位（摘要）

开源侧同时满足以下条件的项目 **稀缺**：

- [x] 桌面端（非纯 Web）  
- [x] 多媒体参考（图 / 视频 / 音频 / 链接等）  
- [x] 嵌套组织（栈 / 文件夹语义）  
- [x] 本地可搬运工程文件  
- [x] Agent / MCP 可编程读写  

IC2 的产品组合正好落在该空白附近，这既是机会，也意味着 **无法靠「抄一个高 Star 开源项目」完成定位**，需要独立叙事与交付。

---

## 8. 建议的持续跟踪清单

### 8.1 搜索词

```text
topic:infinite-canvas
PureRef alternative
reference image viewer
reference board
moodboard canvas
infinite canvas desktop
```

### 8.2 复评节奏

| 触发条件 | 动作 |
|----------|------|
| 每季度 | 复拉 A 组 + 综合排序表前 10 的 Star 与维护状态 |
| 出现新 PureRef 替代 | 补入 A 组并更新相关度 |
| IC2 发版 / 定位调整 | 复核「空白位」是否仍成立 |

### 8.3 使用本表时注意

- **不要用 Star 单独衡量威胁。** BeeRef Star 不高，但对「参考图板」用户心智的重合度可能高于 Excalidraw。  
- **闭源 PureRef 仍是主对标**，开源表是补充而非替代。  
- **技术选型参考**（tldraw、leafer、fabric）与 **产品竞品参考**（BeeRef、Lorien）应分开使用。

---

## 9. 附录

### 9.1 数据获取方式（可复现）

```text
# 专题页
https://github.com/topics/infinite-canvas

# 单仓元数据（示例）
GET https://api.github.com/repos/rbreu/beeref
# 字段：stargazers_count, description, language, pushed_at

# 关键词搜索（示例）
GET https://api.github.com/search/repositories?q=PureRef+in:readme,description&sort=stars
GET https://api.github.com/search/repositories?q=topic:infinite-canvas&sort=stars
GET https://api.github.com/search/repositories?q=reference+image+viewer&sort=stars
```

### 9.2 与 IC2 内部文档的关系

| 文档 | 关系 |
|------|------|
| `docs/CODEBASE_MATURITY_ASSESSMENT.md` | 评估 IC2 自身工程 / 产品成熟度 |
| **本文** | 评估外部相似项目与竞争位置 |
| `docs/COMPETITIVE_RESEARCH.md` 等 | 若存在产品向竞品文案，可与本文交叉引用；**本文以 GitHub 事实与 Star 快照为准** |

### 9.3 文档维护

| 项 | 说明 |
|----|------|
| 适用场景 | 产品定位、差异化叙事、技术选型参考、投资 / 合作尽调中的竞品附录 |
| 更新建议 | 至少按季度更新 Star 与 A 组名单；重大竞品出现时即时修订 |
| 方法约束 | 复评应重新拉取 GitHub 元数据，避免沿用过期 Star 做决策 |

---

*本文件由 GitHub 公开数据调研生成，不构成完整商业竞品分析。闭源产品（如 PureRef）、应用商店分发与付费转化需另表补充。*
