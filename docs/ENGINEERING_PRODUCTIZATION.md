# Infinite Canvas 2 — 工程化 / 产品化计划

> **状态**：本地执行文档（`docs/` 默认不入库）  
> **基线**：v1.1.0 · Tauri 2 · React 19 · Zustand · Windows  
> **目标**：把「功能完整、主路径可用」的狗粮级应用，收敛为「可托付、可回归、可分发」的早期产品。  
> **原则**：先稳住已有深度，再扩功能；用可测标准代替感觉。  
> **产品定位**：见 `PRODUCT.md`（含 IC2 + MCP 战略空白）；本文件只定工程门槛，不改定位。

---

## 0. 如何理解「能跑、有板子模型，但还需再工程化」

一句话：

| 说法 | 含义 |
|------|------|
| **能跑** | 主流程可用：打开 → 摆素材 → 进 stack → 保存 → 再打开 |
| **有完整板子模型** | 领域已成型：`CanvasItem` / `StackRecord` / `containerId` / `.icanvas` v3 / dirty / history |
| **vibe coding 气质** | 功能是迭代「先做对一条路径」堆出来的；关键逻辑集中在大文件，边界 case 靠手测，缺少自动护栏 |
| **再工程化** | 不是重写产品，而是：**拆模块、补测试、定性能与可靠性门槛、接上 CI 与发布**，让改一处不炸全局 |

工程化 = 让「正确性可重复证明」；产品化 = 让「陌生人机器上也不碎、可安装可恢复」。

---

## 1. 现状快照（工程视角）

| 维度 | 现状 | 风险 |
|------|------|------|
| 功能深度 | 嵌套 stack、G/R/S、crop、I/O、链接预览、沉浸模式 | 边角交互互相耦合 |
| 代码体量 | ~1.7 万行 TS + ~1k Rust | 回归面大 |
| 热点文件 | `useInfiniteCanvasController.ts` ~2.1k · `stackActions.ts` ~1.9k | 单文件改动易串味 |
| 测试 | 6 个单测文件、约 20+ case，覆盖 geometry / stacks / boardFile / clone | 手势、导航、undo 几乎无自动化 |
| 工具链 | `tsc` + Vite + vitest 脚本；**CI 无**；`npm test` 需依赖装齐 | 合并前无强制闸门 |
| 分发 | portable exe + NSIS/MSI 能力 | 无签名、无自动更新、无崩溃上报 |
| 平台 | Windows / WebView2 | 范围可控，先把这一条做透 |

**已有优势（工程化要保护，不要推倒）：**

- 纯函数 utils 已较多：`stacks` / `geometry` / `crop` / `boardFile` / `itemPatch`
- store 已开始拆 actions（document / selection / stack / history / viewport）
- 保存：原子写 + `.bak` + 完整性校验 + 体积上限
- 安全：CSP、FS scope、embed sandbox、链接 SSRF 基线

---

## 2. 成功标准：什么叫「可以」

分三档。本计划默认冲到 **B 档**；A 档日常自用可并行达成。

### A. Dogfood 合格（自用天天开）

| 标准 | 门槛 |
|------|------|
| 主路径 | 连续使用 2 小时无锁 UI、无丢板 |
| 保存 | 正常保存 / 杀进程后 `.bak` 可恢复 |
| 打开 | 典型板子（见 §5 样本）打开 < 5s，无脏标记误报 |
| 导航 | A⊃B⊃C 进退、breadcrumb 跳转 fan 不错位 |
| 类型检查 | `npm run build`（含 `tsc`）必过 |

### B. 公开 Beta / 给熟人装（本计划目标）

| 领域 | 门槛（Must） |
|------|----------------|
| **测试** | 单元 + 文档模型回归 **≥ 80 条**；核心路径清单 **100% 手测或 E2E 打勾**；`npm test` 在 CI 绿 |
| **可靠性** | 定义的 P0 场景 **0 已知崩溃**；异常输入（坏文件、超大文件、中断保存）有明确 UI 错误，不白屏 |
| **可维护** | 新增手势/导航逻辑不写进 >800 行单文件；store 动作按域可定位；关键不变量有测试锁定 |
| **性能** | 见 §6 基线全部达标 |
| **分发** | 一键安装或 portable；版本号一致；安装后 `.icanvas` 关联可用；卸载不留关键垃圾（或文档说明） |
| **可信** | 保存失败可感知；关闭有未保存提示；启动失败有日志或可读错误 |

### C. 商业 1.0（本计划不一次做完，仅列方向）

| 领域 | 门槛 |
|------|------|
| 崩溃上报 / 匿名诊断 | 可选 opt-in |
| 代码签名 + 智能屏不拦 | Windows 签名证书 |
| 自动更新 | Tauri updater 或等价 |
| 性能 | 更大数据集、长会话内存稳定 |
| 支持 | 已知问题页 + 反馈入口 |

**判定口诀：**

> B 档 =「我改 stack 动画后，CI 能拦住回归；用户杀进程后板子还在；100 张图的板子仍可操作。」

---

## 3. 工作流总览（四条轨道并行，优先级递减）

```
轨道 1  安全网     测试基建 + 不变量 + CI          ← 最先
轨道 2  可靠性     I/O · 崩溃恢复 · 错误面
轨道 3  可维护性   拆热点 · 边界清晰 · 文档契约
轨道 4  性能       基线测量 · 热点优化 · 防回退
         ↓
      分发与发布门槛（B 档验收）
```

**明确不做（本阶段）：** 实时协作、账号同步、完整 DAM、为工程化而重写框架。

---

## 4. 轨道 1 — 测试与可信度（安全网）

### 4.1 分层策略

| 层 | 工具 | 测什么 | 占比建议 |
|----|------|--------|----------|
| **L0 类型** | `tsc --noEmit` | 接口漂移 | 每次提交 |
| **L1 纯函数单元** | Vitest | geometry / crop / stacks / zOrder / boardFile / modalTransform / snap | **60%** 用例量 |
| **L2 store 动作** | Vitest + 内存 store | enter/exit、history、dirty、import/export、clipboard 重映射 | **25%** |
| **L3 集成** | Vitest（少）或脚本 | 完整 pack → parse → assert 往返 | **10%** |
| **L4 手工 / 半自动 E2E** | 清单 + 可选 Playwright | 手势、WebView 特例 | **5%** 但 P0 必过 |

优先测 **纯函数与文档模型**（ROI 最高）；手势全量 E2E 成本高，用「场景清单 + 抽检」代替全面自动化。

### 4.2 测试基建清单（先做环境）

- [ ] 确认 `vitest` 可 `npm test` 本地一次跑通（必要时 `npm i` / 锁文件）
- [ ] `vite.config.ts` 或 `vitest.config.ts`：路径别名与 `src` 一致
- [ ] `package.json` scripts：
  - `test` / `test:watch`
  - `typecheck`: `tsc --noEmit`
  - `test:ci`: `npm run typecheck && npm run test`
- [ ] GitHub Actions（或等价）：`push` / `PR` → Node 18+ → `npm ci` → `test:ci`
- [ ] （可选）Rust：`cargo test` 覆盖 link preview SSRF 纯函数部分

### 4.3 必须锁定的不变量（Invariants）

下列规则一旦破坏就是 P0，**每条至少 1 个自动化用例**：

| ID | 不变量 | 建议落点 |
|----|--------|----------|
| I1 | `item.containerId` 指向 `root` 或存在的 `StackRecord.id` | `stacks` / import |
| I2 | stack 树无环；`parentId` 合法 | `stacks` |
| I3 | 同一 container 内 `zIndex` 可全序（允许并列但 raise 后稳定） | `zOrder` |
| I4 | enter stack 后 free 位姿与 exit gather 的 fan 可解释（无 NaN / 飞出） | stack 动作 + 动画 helper |
| I5 | pack `.icanvas` → parse → 关键 items/stacks/assets 一致 | `boardFile` |
| I6 | 坏文件 / 超限文件 **拒绝打开** 且不污染当前板 | `boardFile` / `boardIO` |
| I7 | 用户编辑标 `dirty`；自动 link preview **不**误标 dirty | `itemPatch` / document actions |
| I8 | undo/redo 不留下 `animating` / `pendingNavigation` 卡死 | history + import |
| I9 | 删除 item 后不可达 blob URL 可回收；undo 仍能显示 | `blobUrls` / cloneDocument |
| I10 | 嵌套复制/粘贴后 id 全新且树结构同构 | `cloneDocument` / clipboard |

### 4.4 测试用例目录（建议新增）

```
src/utils/__tests__/
  geometry.test.ts          # 已有 → 扩旋转 AABB、命中
  crop.test.ts              # 新增：旋转禁止 crop、多选 crop、uncrop 往返
  stacks.test.ts            # 已有 → 扩环检测、叶子收集、freeFanRel
  zOrder.test.ts            # 新增：整树 raise 连续
  boardFile.test.ts         # 已有 → 扩 .bak 语义、超大拒绝、legacy
  modalTransform.test.ts    # 新增：R 15°、S 中心、G snap 输入输出
  snap.test.ts / align.test.ts
  selectionBounds.test.ts

src/store/__tests__/
  cloneDocument.test.ts     # 已有
  history.test.ts           # dirty / 深度 / 媒体共享引用
  stackEnterExit.test.ts    # 单层/多层 pendingNavigation
  importBoard.test.ts       # 中断动画状态清理
  clipboard.test.ts         # 子树重映射
  dirty.test.ts             # z raise / auto meta

src-tauri/ tests or #[cfg(test)]
  link_preview_ssrf.rs      # 私网 IP / 危险 scheme 拒绝
```

### 4.5 用例设计模板（写 case 时套用）

```text
名称: [模块] 在 <前置> 时，执行 <动作>，应 <结果>
前置: 最小 fixture（items[] + stacks[] + viewport）
动作: 调用纯函数或 store action（禁止依赖真实 DOM/Tauri，除非 L4）
断言: 结构相等 / 数值近似（几何用 toBeCloseTo）/ 抛错类型
清理: 无全局污染
```

**Fixture 原则：**

- 用工厂函数：`note()` / `image()` / `stack()`（参考现有 `stacks.test.ts`）
- 媒体 `src` 用短 data URL 或假字符串，不做真实解码
- 每个 case 一个意图；禁止「超级 case 测 10 件事」

### 4.6 场景级手测清单（L4，发布前勾选）

保存为 `docs/QA_CHECKLIST.md` 或本文件附录执行：

**P0 每次发版必过**

1. 新建 → 拖入图/视频/音频/文本/链接 → Ctrl+S → 重启 App → 板子一致  
2. Ctrl+G 建 stack → 双击进入 → 摆放 → Esc 退出 → fan 正确  
3. A⊃B⊃C 进入 C → breadcrumb 点 A → 各层 fan 正确、可再进入  
4. 多选 G/R/S → 确认/Esc 取消 → undo 回到变换前  
5. C 裁剪 → Alt+C 还原；旋转后 C 有 toast 且不损坏  
6. 关闭脏板：Save / Discard / Cancel 行为正确  
7. 打开损坏 JSON / 空文件 / 超大文件：提示错误，当前板不丢  
8. 文件关联：双击 `.icanvas` 启动并打开  

**P1 发版抽测**

9. Alt+拖复制含嵌套 stack；粘贴后改子项不影响源  
10. 沉浸模式 Ctrl+F；样式条仍可用  
11. 外链预览失败时卡片仍可双击打开  
12. 从资源管理器拖入混合文件（图+txt+url）  

### 4.7 覆盖率与数量目标（务实，不追 100%）

| 指标 | B 档目标 |
|------|----------|
| 自动化用例数 | ≥ 80（从现有 ~20 扩） |
| 不变量 I1–I10 | 100% 有测 |
| utils 纯函数核心文件 | 行覆盖 voluntary ≥ 60%（几何/stack/board 优先） |
| UI 组件 | **不**强求覆盖率；靠清单 |
| CI | main 保护：红不能合（若单人可自建习惯：push 前 `test:ci`） |

---

## 5. 轨道 2 — 可靠性

### 5.1 风险清单 → 对策

| 风险 | 现象 | 对策 | 完成标准 |
|------|------|------|----------|
| 保存中断 | 半截文件 | 已有 temp + rename；补「写失败 toast + 保留内存脏」 | 拔掉目标盘/只读目录可演示 |
| 打开半残 | 白屏/脏数据 | parse 前 magic/version；失败 rollback | I6 自动化 |
| 动画中开板 | UI 锁死 | import 清 `animating`/`pendingNavigation`（已有）+ 测 | I8 |
| 大板 OOM | 崩溃 | 打开前体积门禁；可选「链接媒体不内嵌」策略后续 | 超限有文案 |
| 外链/embed | 卡死渲染 | sandbox 已收；iframe 错误降级占位 | 坏 embed 不拖垮手势 |
| 未捕获异常 | 白屏 | React error boundary + 全局 `error` 日志到本地文件（可选） | 抛错仍可见「恢复/复制日志」 |
| 杀进程 | 丢数据 | 依赖用户存；可选：定时自动 `.icanvas.tmp` autosave（B+） | 至少文档说明「请常存」；B 档建议轻量 autosave |

### 5.2 错误面（产品可信）

统一错误信息模型（建议）：

```ts
type AppError = {
  code: 'OPEN_TOO_LARGE' | 'OPEN_CORRUPT' | 'SAVE_FAILED' | 'MEDIA_DENIED' | ...
  message: string   // 用户可读
  detail?: string   // 可复制，给反馈用
}
```

- [ ] 打开/保存/导入 全部走同一 toast 或对话框样式  
- [ ] 禁止 `console.error` 作为唯一反馈  
- [ ] 关键错误 **不**静默 `dirty=false`

### 5.3 样本板子（回归资产）

在仓库外或 `testdata/`（注意 git LFS / 体积）准备：

| 样本 | 内容 | 用途 |
|------|------|------|
| `smoke-mini.icanvas` | 图+字+一层 stack | 每次 CI 可选 fixture 文本版 |
| `nested-abc.json` | 无大媒体的结构夹具 | 单元/集成 |
| `media-heavy`（本地 only） | 50–100 张图 | 性能手测 |
| `legacy-v1.json` | 旧格式 | 迁移 |

文本夹具进 git；大媒体只放本机 `testdata/local/` 并 gitignore。

### 5.4 可靠性完成标准（B）

- [ ] P0 手测清单全绿（连续 2 轮，中间夹一次代码改动）  
- [ ] 无「打开后无法点击」类已知 bug  
- [ ] 保存失败可感知且不标记为已保存  
- [ ] 至少一种崩溃恢复路径（`.bak` 或 autosave）写进 README  

---

## 6. 轨道 3 — 可维护性 / 再工程化（不重写）

### 6.1 目标结构（渐进）

```
hooks/
  useInfiniteCanvasController.ts   # 变薄：只编排
  gestures/
    marquee.ts / dragMove.ts / modalGRS.ts / cropSession.ts
store/
  actions/                         # 已有：继续按域收敛
  selectors.ts                     # 只读派生，避免组件内重复遍历
utils/                             # 纯函数大本营（已有优势）
```

**规则（团队公约，可写进 CONTRIBUTING 或本文件）：**

1. 新几何/stack 规则 **必须** 进 `utils` + 单测，禁止只写在 React 事件里。  
2. 单文件软上限 **~800 行**；超则拆，不靠「还能写」。  
3. store action 禁止直接操作 DOM。  
4. Tauri 调用只经 `desktop.ts`（已有方向，保持）。  

### 6.2 拆分顺序（按风险，不是按洁癖）

| 顺序 | 拆什么 | 为什么 | 验收 |
|------|--------|--------|------|
| 1 | crop / marquee / GRS 会话从 controller 抽出 | 可单测数学与状态机 | 旧行为测住 + 行数下降 |
| 2 | stack enter/exit RAF 独立模块 | 动画与文档 patch 分离 | I4/I8 测绿 |
| 3 | selection 命中与命中缓存 | 降耦合 | 点击回归清单 |
| 4 | document I/O 与 UI toast 边界 | 错误面统一 | 失败用例 |

**禁止**：为拆而拆、大爆炸 PR。每一刀：`测试先红/先锁 → 移代码 → 绿`。

### 6.3 文档契约（短而硬）

| 文档 | 内容 | 更新时机 |
|------|------|----------|
| README | 用户功能与快捷键 | 行为变更 |
| 本文件 | 工程门槛与计划 | 门槛变更 |
| `types/canvas.ts` 注释 | 字段语义（containerId / stackPreview / freeFanRel） | 模型变更 |
| CHANGELOG | 用户可见变化 | 每版本 |

架构长文保持本地即可；**契约以类型 + 测试为准**。

### 6.4 可维护性完成标准（B）

- [ ] controller 或 stackActions 至少完成 **一轮** 有意义拆分（各降 ≥30% 或抽出 ≥2 个可测模块）  
- [ ] 新贡献者能根据「改 stack 规则去 utils + test」路径改对一处  
- [ ] `npm run test:ci` 本地 < 60s  

---

## 7. 轨道 4 — 性能

### 7.1 测量方法（先量后优）

| 指标 | 如何量 | 工具 |
|------|--------|------|
| 打开耗时 | 从选文件到可交互 | 性能标记 / 手动秒表 |
| 交互帧率 | 平移/缩放 100 items | Edge/WebView 性能面板 |
| 内存 | 打开 heavy 板 + 操作 10min | 任务管理器 |
| 保存耗时 | pack + 写盘 | console time / 日志 |
| history 内存 | undo 栈深度 × 板大小 | 开发日志计数 |

建立 `docs/PERF_BASELINE.md` 记一笔 **机器型号 + 版本 + 数字**，避免「感觉变慢」。

### 7.2 B 档性能基线（建议值，可按机器校准）

假设参考机：近 5 年 Windows 笔记本，板内 **80 张缩略级图 + 20 文本 + 3 层 stack**。

| 场景 | 目标 |
|------|------|
| 打开上述板子 | ≤ 5s 可交互 |
| 空闲平移/缩放 | 视觉上流畅（力争 ≥ 50 FPS） |
| 单次保存（媒体已 data URL） | ≤ 3s 或有进度反馈 |
| 连续 undo 10 次 | ≤ 100ms/次 量级，UI 不卡死 |
| 内存 | 打开后 10 分钟操作，RSS 不线性狂涨（无泄漏曲线） |

更重的「100 张 4K 原图内嵌」**不作为 B 档必达**；若要支持，单列优化项（外置资源、解码限流）。

### 7.3 优化候选（有数据再做）

| 方向 | 手段 | 前提 |
|------|------|------|
| 渲染 | 视口 culling、预览降采样、减少 box-shadow | 配置文件显示卡 |
| 媒体 | 列表用 bitmap 解码限流；视频海报 | heavy 样本 |
| History | 已共享媒体字符串；可再降 cap 或 structural sharing | 内存曲线 |
| Stack 预览 | 折叠 pile 用缓存层/少 DOM | 进退卡顿 |
| 保存 | 增量 pack / 不重复 base64 | 保存慢 |

### 7.4 性能完成标准（B）

- [ ] 有书面 baseline 数字  
- [ ] 无已知「空板都卡」问题  
- [ ] 对 heavy 样本：要么达标，要么产品文案限制（「建议…」）  

---

## 8. 分发与产品化门槛（B 档收尾）

| 项 | 动作 | 标准 |
|----|------|------|
| 版本三合一 | npm / tauri.conf / Cargo | 同一 semver |
| 产物 | `tauri build` → portable + 安装包 | 干净机器安装可用 |
| 文件关联 | `.icanvas` Open with | QA P0-8 |
| 图标与名称 | Infinite Canvas | 任务栏可辨 |
| README | 安装 / 快捷键 / 格式说明 / 已知限制 | 陌生人能装上 |
| CHANGELOG | 1.1.x → 1.2.0 工程化版本记录 | 有 |
| 许可证 | 若公开：选 MIT/专有并写明 | 不模糊 |
| （可选）签名 | 证书签名 exe | 智能屏警告可接受或消除 |

**本阶段可不做：** 自动更新、崩溃上报 SaaS、多语言、多平台。

---

## 9. 分阶段执行计划

### Phase 0 — 一周内：安全网点亮（必须）

**目标：** 测试可跑、CI 可挡、不变量开测。

- [ ] 修复/确认 `npm test`  
- [ ] `typecheck` + `test:ci` scripts  
- [ ] CI workflow  
- [ ] 补齐 I1–I10 中至少 **I1 I5 I6 I7 I8**  
- [ ] 建立 `QA_CHECKLIST` 并跑通一轮 P0  

**出口：** 任意提交可本地一条命令验证；破坏 board 往返会被测到。

### Phase 1 — 2–3 周：可靠性 + 用例扩到 80+

- [ ] boardIO 错误面统一  
- [ ] React error boundary  
- [ ] stack enter/exit / history / clipboard 测试  
- [ ] crop / modalTransform 纯函数测  
- [ ] `.bak` 恢复路径文档化或入口  
- [ ] （建议）间隔 autosave 草案  

**出口：** P0 清单双轮绿；自动化 ≥ 80 case。

### Phase 2 — 2–3 周：可维护拆分 + 性能基线

- [ ] 从 controller 抽出 crop + GRS 会话  
- [ ] stack 动画模块边界清晰  
- [ ] PERF_BASELINE 首测  
- [ ] 针对超标的 1–2 个热点优化  

**出口：** 热点文件明显变短；性能数字可复述。

### Phase 3 — 1–2 周：Beta 包装

- [ ] 版本 bump（如 1.2.0-engineering 或 1.2.0）  
- [ ] 干净机安装验收  
- [ ] README / CHANGELOG / 已知问题  
- [ ] 冻结功能一周只修 bug（**feature freeze**）  

**出口：** 达到 §2 B 档清单；可给 5–10 个外部用户。

### 之后（C 档 backlog，不阻塞 B）

- 代码签名、自动更新  
- 可选诊断日志上传  
- macOS 评估  
- 检索 / 置顶等产品功能（**B 达标后再开**）

---

## 10. 优先级决策树（日常开发怎么选活）

```
这个改动会破坏板子或钱相关吗？ → 先写/补测试再改
是新功能还是修可靠？ → B 档前优先可靠
是大重构吗？ → 必须有不变量测试锁住再搬
是性能优化吗？ → 先有 baseline 数字
是「很好玩」的功能吗？ → 进 backlog，B 后做
```

---

## 11. 角色与节奏（单人也可）

| 节奏 | 动作 |
|------|------|
| 每日 | 改核心逻辑必跑 `test:ci` |
| 每功能 PR | 对应不变量或清单条目 |
| 每周 | 跑一遍 P0 手测（30–45 min） |
| 每版本 | Phase 出口检查表勾选 |

单人时：**Phase 0–1 严守，Phase 2 可裁剪拆分量，但不可裁测试与 P0 清单。**

---

## 12. B 档总验收表（打印勾选）

### 工程

- [ ] `npm run test:ci` 绿  
- [ ] CI 绿（或等价纪律）  
- [ ] 自动化用例 ≥ 80  
- [ ] I1–I10 全覆盖  
- [ ] 无 P0 已知崩溃 / 锁 UI  

### 产品可靠

- [ ] QA P0 全绿 ×2  
- [ ] 错误可感知  
- [ ] 保存/打开/关联路径验证  
- [ ] 恢复策略（`.bak`/autosave）说明存在  

### 可维护 / 性能

- [ ] 至少一次关键模块拆分落地  
- [ ] PERF_BASELINE 有数且达标或有产品限制说明  

### 分发

- [ ] 版本一致  
- [ ] 干净环境安装成功  
- [ ] README 可引导安装使用  

**全部勾完 ⇒ 工程化产品化阶段性完成（公开 Beta 就绪）。**

---

## 13. 附录：第一批建议立刻写的测试（复制即用的意图列表）

1. `parseICanvas` 缺少 magic → throw  
2. asset 引用丢失 → integrity fail  
3. legacy v1 → v3 字段默认值齐全  
4. `collectDescendantStackIds` 深树  
5. 构造环状 parentId → detect/reject（若尚未拒绝则先实现拒绝）  
6. crop 往返世界坐标（已有扩展多选/旋转拒绝）  
7. `applyItemPatch` dirty:false 不置脏  
8. `importBoard` 后 `animating===false`  
9. undo 后 `pendingNavigation` 清空  
10. clone stack 树 id 全替换且 parent 指针自洽  
11. z-order raise 整树连续段  
12. pack 后再 parse items.length 相等  
13. 超大字符串拒绝 parse  
14. modal R + shift 得到 15° 倍数  
15. uncrop 保持 rotation 与 visible center  

---

## 14. 一句话收束

> **产品灵魂已经在板子模型和交互里；工程化是给这套灵魂装上安全带、仪表盘和维修手册。**  
> 本计划不要求变成大厂平台，只要求：**改得动、测得到、发得出、别人机器上不碎。**

完成 B 档后，再开检索/置顶/跨平台等功能，才是「产品化扩张」；在此之前的扩张都会放大 vibe coding 债务。
