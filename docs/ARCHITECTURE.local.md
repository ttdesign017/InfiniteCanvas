# InfiniteCanvas2 — 架构与底层逻辑详解

> **本文件仅供本地学习，已被 `.gitignore` 排除，不会进入 git 仓库。**  
> 面向「用 vibe coding 拼出了能跑的产品、但想搞懂底层」的作者本人。  
> 对应代码约 2026-07 主线（Tauri 2 + React 19 + Zustand）。

---

## 0. 一句话总览

这是一个 **桌面无限画布应用**：

- **外壳**：Tauri 2 打开一个无边框 WebView2 窗口（Windows）。
- **UI**：React 画一个可平移/缩放的「世界坐标系」舞台。
- **真相源**：一个巨大的 Zustand store（`useCanvasStore`）持有板子上所有元素、嵌套文件夹、视口、历史、脏标记。
- **落盘**：把状态序列化成 `.icanvas`（JSON + base64 媒体），经 Tauri `fs` 插件写盘。

Electron 版同思路；这里换成系统 WebView，体积小很多。

---

## 1. 进程与技术栈分层

```
┌─────────────────────────────────────────────────────────┐
│  OS 窗口 (WebView2)                                       │
│  ┌─────────────────────────────────────────────────────┐│
│  │  React UI (Vite 打包的 HTML/JS/CSS)                  ││
│  │   InfiniteCanvas / Toolbar / items/* / Style…       ││
│  │   hooks: keyboard, close guard, menus               ││
│  │   Zustand store ←→ utils (geometry, stacks, IO)     ││
│  └───────────────────────┬─────────────────────────────┘│
│                          │ invoke / plugin IPC           │
│  ┌───────────────────────▼─────────────────────────────┐│
│  │  Rust (src-tauri)                                     ││
│  │   窗口生命周期、force_exit、启动文件路径               ││
│  │   fetch_link_preview（网络 + SSRF 防护）               ││
│  │   plugins: dialog / fs / opener                        ││
│  └───────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

| 层 | 职责 | 关键路径 |
|----|------|----------|
| React 组件 | 画图、命中、拖拽手势、表单 | `src/components/` |
| Hooks | 全局快捷键、关闭拦截、菜单热键 | `src/hooks/` |
| Zustand | **唯一业务状态** | `src/store/useCanvasStore.ts` |
| Pure utils | 几何、stack 模型、文件格式、导入 | `src/utils/` |
| Types | 文档数据结构 | `src/types/canvas.ts` |
| Rust | 特权 I/O、安全网络 | `src-tauri/src/lib.rs` |
| 权限清单 | 前端能碰哪些原生 API | `src-tauri/capabilities/default.json` |

**设计原则（事实上的）：**

1. **UI 不直接碰 Electron/Tauri 细节** → 经 `desktop.ts` 抽象（`isDesktop()`、对话框、读写文件、外开链接）。
2. **几何与嵌套规则尽量纯函数** → `stacks.ts` / `layout.ts` / `zOrder.ts` / `itemPatch.ts`，方便推理，也少踩 React 时序坑。
3. **动画与交互锁在 store** → `animating`、`stackEnterAnim`、`pendingNavigation`，避免动画中途删改造成错位。

---

## 2. 坐标与视口（为什么能「无限」）

### 2.1 两套坐标

| 名字 | 含义 |
|------|------|
| **屏幕坐标** | 鼠标事件的 `clientX/Y`，单位是 CSS 像素 |
| **世界坐标** | 画布内容的位置 `item.x/y`，可任意大/负 |

转换（概念上）：

```
worldX = (screenX - viewport.x) / viewport.zoom
worldY = (screenY - viewport.y) / viewport.zoom
```

`viewport = { x, y, zoom }` 存在 store 里。平移改 `x/y`，滚轮/Ctrl± 改 `zoom` 并绕光标缩放。

### 2.2 渲染方式

`InfiniteCanvas` 通常用一层 transform：

```
transform: translate(viewport.x, viewport.y) scale(viewport.zoom)
```

子元素用世界坐标的 `left/top/width/height`（或等价 CSS）。这样 **不必为无限空间分配无限 DOM**，只渲染当前板子上的有限 items。

### 2.3 嵌套后的「当前容器」

不是整棵树同时可编辑：

- `currentContainerId === 'root'` → 在首页画布
- `currentContainerId === 某个 stack id` → 你「进入」了这个文件夹，只看到 `containerId` 属于它的 items + 它的子 stack 文件夹

父级上的子成员用 **`stackPreview`** 画成扇形预览（不可单独拖），真正 free 位姿在 `x/y` 里留给「进入之后」。

---

## 3. 文档数据模型（什么叫「板子」）

核心类型在 `src/types/canvas.ts`。

### 3.1 `CanvasItem`（元素）

联合类型：`image | gif | video | text | textcard | link | scribble | embed`。

公共字段（`BaseItem`）：

| 字段 | 作用 |
|------|------|
| `id` | 稳定主键 |
| `x, y, width, height, rotation` | 几何（当前容器内的 free 位姿） |
| `zIndex` | 同容器内叠放顺序 |
| `containerId` | 住在哪个画布：`undefined`/`root` 或某个 stack id |
| `stackPreview?` | 父画布上的扇形预览位姿 |
| `stacked` / `stackGroupId` | **旧模型 / Ctrl+G 动画中途**；嵌套完成后应清掉 |
| `locked?` | 锁定（少用） |

媒体另有 `src`、`naturalWidth/Height`、`crop` 等。

### 3.2 `StackRecord`（可进入的文件夹）

| 字段 | 作用 |
|------|------|
| `id`, `parentId` | 树结构 |
| `name`, `x,y,width,height`, `zIndex` | 父画布上的文件夹 chrome |
| `viewport?` | 上次在里面编辑时的视口（再进入可恢复） |
| `freeFanRel?` | 退出时缓存的「整棵叶子扇形」相对文件夹原点的偏移；**祖先进出时不要乱重算** |

### 3.3 运行时状态 vs 持久化快照

**运行时** store 还多很多 **不进文件** 或仅部分进文件的字段：

| 字段 | 是否进 `.icanvas` | 含义 |
|------|-------------------|------|
| `items`, `stacks` | ✅ | 文档正文 |
| `viewport`, `homeViewport` | ✅ | 当前视口 + 首页视口 |
| `nextZ` | ✅ | 下一个可用 z |
| `boardName`, `currentContainerId` | ✅ | 名、打开时在哪一层 |
| **`dirty`** | ❌ | 是否有未保存修改（见第 5 节） |
| `boardFilePath` | ❌ | 当前打开的磁盘路径 |
| `selectedIds`, `selectedStackIds` | ❌ | 选中 |
| `history` / `future` | ❌ | 撤销栈 |
| `animating`, `stackEnterAnim`, `pendingNavigation` | ❌ | 动画机 |
| `tool`, `immersiveMode`, `snapEnabled`… | ❌ | UI 模式 |
| `editingId`… | ❌ | 正在打字的元素 |

`exportBoard()` 只打包该进文件的字段 → `BoardSnapshot` → 再 `packICanvasDocument` 嵌媒体。

---

## 4. 状态机：谁改 store、怎么改

### 4.1 数据流

```
用户输入 (pointer / keyboard / drop)
    → 组件 / hooks
    → store actions (select, moveItems, enterStack, pushHistory…)
    → set({ ... }) 触发 React 订阅重渲染
    → 必要时 boardIO.save → desktop.writeText
```

### 4.2 为什么 store 这么大

`useCanvasStore.ts` 同时管：

1. 文档 CRUD  
2. 选择与 z 抬升  
3. 布局动画 RAF  
4. 进入/退出 stack 的 morph  
5. 剪贴板  
6. undo/redo  
7. 导入导出字段  

这是 vibe coding 常见的 **「God Store」**：功能快，但认知负担高。  
近期拆出了：

- `store/types.ts` — 类型  
- `store/itemPatch.ts` — 纯补丁  
- `hooks/useHistoryOnce.ts` — 手势级历史  

**逻辑仍集中，接口更干净。**

### 4.3 `ItemPatchOptions`（dirty / history 解耦）

```ts
updateItem(id, patch, { dirty?: boolean, history?: boolean })
```

| 选项 | 默认 | 用途 |
|------|------|------|
| `dirty: true` | 是 | 用户改了内容 → 关软件要提示保存 |
| `dirty: false` | — | **自动**链接预览、图片代理 → 不能把干净板弄脏 |
| `history: true` | 否 | 本次补丁前拍一张 undo |

连续控件（拖颜色、打字）用 `useHistoryOnce`：**整段手势只 push 一次**，避免历史爆炸。

---

## 5. `dirty` 到底是什么、为什么重要

### 5.1 定义

```text
dirty === true  ⟺  内存中的文档与「上次成功保存 / 刚打开的磁盘文件」不一致
dirty === false ⟺  可以安全关掉，不必问「要不要保存」
```

它是一个 **布尔会话标志**，不是文件内容的一部分。

### 5.2 谁把它设为 true

典型路径：

| 动作 | 为何 dirty |
|------|------------|
| `pushHistory()` | 即将发生可撤销的文档修改（约定：进历史的操作都改了文档） |
| `updateItem` 默认 | 改了元素字段 |
| `addItems` / `deleteSelected` / 布局 / stack 进出写位姿 | 文档变了 |
| `setBoardName` | 名称变了 |
| 选中抬升 z（P1 后） | 若 z 真变了，保存后应保留顺序 |

### 5.3 谁把它设为 false

| 动作 | 时机 |
|------|------|
| `importBoard` / 打开文件成功 | 刚加载，与磁盘一致 |
| `clearDirty()` | 保存成功且保存期间用户没继续改 |
| 新建空白（初始） | `dirty: false` |

`saveCurrentBoard` 的细节很关键：

1. 拍 `exportBoard()` 快照  
2. pack + 写盘 + **回读校验**  
3. 对比「保存开始时的 items/stacks/viewport 引用」与现在是否仍相同  
   - 相同 → `dirty: false`  
   - 保存过程中用户又拖了东西 → **保持 `dirty: true`**（避免「保存了旧快照却宣称干净」）

### 5.4 谁读 dirty

| 读者 | 行为 |
|------|------|
| `useCloseGuard` / 关闭对话框 | dirty 则问保存/丢弃/取消 |
| `openBoardFromDisk` | dirty 则先问是否保存当前板 |
| `beforeunload`（浏览器） | dirty 则浏览器原生拦截 |
| 窗口标题/UI（若以后做） | 可显示「● 未保存」 |

### 5.5 历史上的坑（帮助你理解设计）

1. **链接 OG 自动回填**若走默认 `updateItem` → 打开未改的板也会 dirty → 关掉狂弹保存框。  
   → 应用 `{ dirty: false }`。  
2. **点选抬升 z** 若写 `zIndex` 却不 dirty → 用户觉得「叠放顺序变了」，关掉不提示，重开顺序没了。  
   → P1：z 真正变化时标 dirty。  
3. **`pushHistory` 会 dirty**  
   → 即使后来 undo 回原状，有的实现仍可能 dirty（本项目 undo 仍 `dirty: true`，偏保守：宁可多提示保存）。

### 5.6 和 undo 的关系（别混）

| | dirty | history |
|--|-------|---------|
| 问的问题 | 要不要存盘？ | 能不能 Ctrl+Z？ |
| 生命周期 | 打开→保存/丢弃 | 内存里最多约 50 步 |
| 是否进文件 | 否 | 否 |

可以 dirty 但 history 空（例如某些不 push 的补丁）；也可以 push 后 undo 干净但 dirty 仍 true。

---

## 6. 历史（Undo / Redo）

### 6.1 结构

```ts
HistoryEntry = {
  items, stacks, nextZ, currentContainerId
}
history: HistoryEntry[]  // 过去，最多保留约 50
future: HistoryEntry[]   // 被 undo 掉的，供 redo
```

`pushHistory()`：把 **当前** 状态深拷贝推进 `history`，清空 `future`，并 `dirty: true`。

`undo()`：当前推进 `future`，弹出 `history` 顶部恢复；清 selection/动画锁。

### 6.2 何时该 push

| 该 push | 不该每帧 push |
|---------|----------------|
| 删除、添加、stack、对齐 | 拖动中的每一像素（拖开始 push 一次） |
| 裁剪提交 | 颜色滑条每一帧（`useHistoryOnce`） |
| 打字会话第一次改字 | 链接自动预览 |

### 6.3 内存坑

若对含 **数 MB base64 `data:` 图** 的 items 做 `structuredClone`，50 步历史会复制字符串 → 内存炸。  
P2 方向：clone 时 **共享不可变 `src` 字符串引用**，只复制几何/元数据对象。

---

## 7. 嵌套 Stack 逻辑（最难的一块）

### 7.1 两套「堆叠」概念

| 概念 | 机制 | 用途 |
|------|------|------|
| **同画布 fan 堆** | `stacked` + `stackGroupId` | Ctrl+G 动画过程 / 老文件 |
| **可进入嵌套画布** | `StackRecord` + `item.containerId` | 真正的文件夹 |

Ctrl+G 流程概念上：

1. 对选中 free items 算 fan 目标位姿  
2. 动画到 fan  
3. `nestInto`：创建 `StackRecord`，成员 `containerId` 改到 stack，父级用 `stackPreview` 记 fan 位姿，清 legacy stacked 标志  

### 7.2 进入 (`enterStack`)

1. 可选：把当前 viewport 存进该 stack 或 home  
2. 屏幕空间 folder rect → 全屏 morph（`stackEnterAnim` mode enter）  
3. handoff：`currentContainerId = stackId`，视口切到内层  
4. 成员从 preview 位姿动画到 free `x/y`  

交互锁：`animating === true` 时多数操作拒绝（防半状态）。

### 7.3 退出 (`navigateToContainer`)

关键设计（含近期修复）：

1. **总是先退到直接父级**，再靠 `pendingNavigation` 链式退到更上面（C→A 不会一步跳穿导致 fan 错位）。  
2. 退出时 gather：free → fan，写 `stackPreview` / `freeFanRel`。  
3. `targetContainerId` 立刻改面包屑路径，canvas handoff 等动画结束。  
4. `freezeStackSurfaceZ`：退出瞬间冻结父画布 z，避免 B 文件夹掉到 free 笔记下面。  

空 stack：可跳过动画直接 handoff。

### 7.4 Z 序

`zOrder.ts`：选中 stack 时 **整树原子抬升**（文件夹 chrome 与叶子连续占 z 段），避免「点文件夹却只有框起来、内容还在下面被挡住」。

---

## 8. 交互层：`InfiniteCanvas` 在干什么

约 2000+ 行，本质是一个 **指针状态机**：

```
DragMode =
  | pan
  | pending-move  → 过阈值 → move
  | marquee
  | resize
  | scribble | erase
  | crop
  | create-note
```

要点：

- **阈值**：先 `pending-move`，避免单击/双击编辑被拖走。  
- **Alt-drag**：过阈值后 `duplicateItems`，origins 必须读 **live** `getState().items`（陈旧 snapshot 会让克隆飞到错误原点）。  
- **拖写合并**：`scheduleDragWrite` + rAF，避免每 pointermove 全量 React 更新。  
- **C 键 + 拖**：裁剪模式（store `cHeld`）。  

Item 视图（`MediaItemView`、`TextCardView`…）只负责 **长什么样 + 局部编辑**；移动/框选多在画布层统一做。

---

## 9. Embed keep-alive

问题：进 stack 会卸载父画布 React 树 → iframe 销毁 → 播客音频停。

解决：`embedIframeCache.ts`

1. 每个 embed id 对应一个 **常驻** `HTMLIFrameElement`  
2. 显示时 `attach` 进当前 host DOM  
3. 卸载时 **park** 到隐藏容器，不 destroy  
4. 指针事件按「是否 interactive」开关（fan 预览不可点）  

Sandbox 在安全和「第三方播放器能否跑」之间折中（见安全章）。

---

## 10. 文件格式 `.icanvas`

### 10.1 流水线

```
exportBoard() → BoardSnapshot
  → packICanvasDocument()  // 媒体变 base64 assets，src 改 icanvas-asset://id
  → JSON.stringify
  → writeText(path)
  → readText + parse 校验
```

打开：

```
readText → parseICanvasFile
  → unpack（asset → data: URL）
  → importBoard（迁移 legacy stack、清动画锁、dirty=false）
```

### 10.2 为何内嵌 base64

引用本地 `C:\...` 路径的板，文件一挪就裂图。  
内嵌后 **离线可打开**，代价是文件巨大、历史/内存压力大。

### 10.3 版本

- 磁盘：`formatVersion: 3`（`boardFile.ts`）  
- 内存快照：`BoardSnapshot.version: 1`（逻辑文档版本）  
- 仍可打开无 magic 的旧 JSON。

---

## 11. 桌面壳与关闭

### 11.1 `desktop.ts`

统一：对话框选文件、读写、`convertFileSrc`（本地路径 → WebView 可加载 URL）、外开链接、窗口 min/max/close。

### 11.2 关闭为何用应用内对话框

Tauri 的 `onCloseRequested` 里调原生 `ask()` 容易 **死锁/挂起**。  
所以：`useCloseGuard` + `CloseSaveDialog` 用 React 对话框；确认后 `force_exit_app` **硬退进程**，避免「窗口关了进程还在」。

### 11.3 启动打开

`fileAssociations` 注册 `.icanvas` → Rust `get_launch_file_path` → `App` mount 后 `openBoardFromPath`。

---

## 12. 链接预览与安全网络

前端 `linkMeta.ts`：桌面 `invoke('fetch_link_preview')`，浏览器则走 Microlink 等。

Rust 侧：

1. 仅 http(s)  
2. 拦 localhost / 私网 IP / 特殊主机名  
3. 重定向再次校验  
4. 限制 body 大小  
5. X / YouTube 走专用 API（HTML 抓取常被封）  
6. 图片尽量转 data URL（WebView 热链常挂）

这叫 **SSRF 缓解**（防通过预览功能打内网）。DNS 重绑定仍是残余风险。

---

## 13. 安全模型（能力边界）

| 配置 | 作用 | 风险直觉 |
|------|------|----------|
| `capabilities/default.json` fs scope | 前端插件能读哪些路径 | 过宽 ≈ 任意读盘（若 XSS） |
| `csp` | WebView 内容安全策略 | `null` = 几乎不拦 |
| `assetProtocol.scope` | 哪些本地文件可当资源 URL | 过宽 ≈ 读任意文件进页面 |
| iframe sandbox | 嵌入页权限 | scripts+same-origin 较强 |

**产品矛盾**：参考图库软件需要打开任意盘符的图；安全最佳实践要最小权限。  
实现上在「能用」与「收紧」之间迭代（CSP、sandbox 先收；fs 对媒体路径仍相对宽）。

---

## 14. 端到端场景串讲

### 场景 A：拖入一张图并保存

1. Drop → `dropImport` / `createMediaFromPath` → blob 或 asset URL  
2. `addItems` → `pushHistory` + dirty  
3. 渲染 `MediaItemView`  
4. Ctrl+S → `exportBoard` → pack base64 → 写 `.icanvas` → 校验 → dirty=false  

### 场景 B：Ctrl+G 进文件夹再退出

1. 选中多图 → quickStack → fan 动画 → nest StackRecord  
2. 双击文件夹 → enterStack morph → currentContainerId 变  
3. 面包屑点 Home → 逐级 exit gather → freeFanRel 写入 → 父级只见文件夹+预览  

### 场景 C：粘贴 X 链接

1. paste → `addLinkCard` placeholder  
2. `LinkCardView` effect → Rust 预览 → `updateItem(..., { dirty: false })`  
3. 用户若改 URL → `{ history: true }` 且 dirty  

### 场景 D：有未保存修改点关闭

1. dirty true  
2. `onCloseRequested` preventDefault  
3. React 对话框 Save / Discard / Cancel  
4. Save 失败则取消关闭；成功或 Discard → force exit  

---

## 15. 目录地图（读代码顺序建议）

1. `types/canvas.ts` — 数据长什么样  
2. `store/types.ts` + `itemPatch.ts` — 补丁与选项  
3. `store/useCanvasStore.ts` — 从 `select` / `pushHistory` / `enterStack` 读起  
4. `utils/stacks.ts` + `zOrder.ts` — 嵌套规则  
5. `components/InfiniteCanvas.tsx` — 指针状态机中段  
6. `utils/boardFile.ts` + `boardIO.ts` — 存盘  
7. `hooks/useCloseGuard.ts` + `useKeyboard.ts` — 会话边界  
8. `src-tauri/src/lib.rs` — 原生边界  

---

## 16. 术语表

| 词 | 含义 |
|----|------|
| **Board / 板** | 整个项目文档（items+stacks+viewport） |
| **Container** | 一个可编辑画布平面（root 或 stack） |
| **Free pose** | 容器内真实 `x/y` |
| **Fan / stackPreview** | 父级折叠扇形展示位姿 |
| **Dirty** | 未保存相对磁盘 |
| **History** | 撤销快照栈 |
| **Handoff** | 动画结束后切换 currentContainer + 视口 |
| **God store** | 单文件扛所有业务状态 |
| **Keep-alive** | iframe 不随 React 卸载而销毁 |
| **SSRF** | 服务端（此处是 Rust 主机）被骗请求内网 |

---

## 17. 刻意没做成什么样（边界）

- **不是** 多人协作 OT/CRDT 文档  
- **不是** 完整矢量设计工具（旋转 UI 未完备）  
- **浏览器 dev** 无完整存盘/原生预览（缺 Tauri）  
- **历史** 不做跨文件、不持久化  

---

## 18. 若你要继续演进（架构建议）

短期：

- 保持 `updateItem` 的 dirty/history 选项纪律  
- 新功能先问：改文档吗？要进 undo 吗？要存盘吗？  

中期：

- 按切片拆 store：`document` / `selection` / `navigation` / `history`  
- stack enter/exit 独立 animation controller + generation token（取消过期 RAF）  

长期：

- 媒体资产表（id → blob），items 只存 assetId，历史极轻  
- 权限按「用户选过的路径」动态 grant  

---

*写给未来的自己：dirty 管存盘良心，history 管反悔，container 管你在哪一层宇宙。三者分清，板子就不会「玄学脏」或「一撤就炸」。*
