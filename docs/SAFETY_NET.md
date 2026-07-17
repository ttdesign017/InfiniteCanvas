# 可回归性安全网 — 进度（给作者的白话说明）

目标：改代码之后，用**一条命令**就能知道「有没有把已有能力弄坏」，而不完全靠手点。

---

## 你只要记住

```bash
npm run check
```

- 全部成功 → 当前自动检查认为没问题  
- 中途失败 → 先不要当「做完了」  
- 推到 GitHub `main` / PR → 云端 Actions 也会跑同一套  
- **发版前**再打开 `docs/QA_CHECKLIST.md` 勾 P0 手测  

---

## 第一步：本机能跑检查 ✅

依赖装全 + `npm run check` 统一入口。

---

## 第二步：板子不能坏 ✅

坏文件拒绝、嵌套往返、打开/撤销清锁、dirty 契约、stack 归属。

---

## 第三步：裁剪 / 变换 + 远程自动查 ✅

crop / G·R·S 规则；`.github/workflows/check.yml`。

---

## 第四步（本步）：吸附对齐 + 发版手测清单 ✅

### 自动规则

| 规则（人话） | 范围 |
|--------------|------|
| 吸附只针对当前画布上的 free 项；嵌套内部项不是父画布吸附目标 | snap |
| 进入式 stack 在父画布上当作**一个**吸附体 | snap |
| 靠近目标边时产生 dx/dy 与参考线；太远不吸 | snap |
| 左对齐 / 水平居中等多选对齐位移正确 | align |
| Pack 收缝保留约 5px 间距 | align / pack |
| 少于 2 个对象时对齐/pack 不改动 | align |

### 手测（机器替不了的部分）

见 **`docs/QA_CHECKLIST.md`**：

- **P0**：每次发版必过（保存重开、嵌套 stack、G/R/S、裁剪、关闭提示、坏文件、关联打开）  
- **P1**：有空再抽测  

---

## 安全网主骨架（到第四步）

```
本机 npm run check  ──►  板子/导航/脏标记
                       ──►  裁剪与 G/R/S
                       ──►  吸附与对齐/pack
                       ──►  GitHub Actions 同套检查
                       ──►  发版 QA_CHECKLIST 手测
```

**到这里，可回归性安全网的「主骨架」可以算立住了。**

---

## 之后（不再叫必做第五步；按需）

| 方向 | 何时做 |
|------|--------|
| 再补几何边角、剪贴板子树等用例 | 修相关 bug 时顺手加 |
| 有测试保护下拆大文件 / 导航状态机 | **已开始**：见下 |
| 性能样本板 + 记数字 | 感觉卡或发重媒体版时 |
| MCP / AI | 产品战略，不是安全网本身 |

### 大文件拆分进度（有 `npm run check` 护航）

| 原文件 | 现状 |
|--------|------|
| `useInfiniteCanvasController.ts` | 抽出 `hooks/canvas/`：见下表 |
| `stackActions.ts` | 拆为 chrome / enter / navigate / layout，composer 组装 |

**`useInfiniteCanvasController` 拆分进度：**

| 阶段 | 结果 |
|------|------|
| 二次拆分 | 纯函数 + surface/ghost/modal hooks |
| **三项高优先** | 见下 |

| 模块 | 职责 | 规模 |
|------|------|------|
| `useInfiniteCanvasController` | 组装壳 | ~290 行 |
| `useCanvasPointerGestures` | 全部指针/拖放手势 | ~1280 行 |
| `stackNavigateActions` | 导航编排（viewport 保存 + 分派） | ~60 行 |
| `stackExitNavigation` | **退出会话**：gather/handoff/链式 silent fold | ~870 行 |
| `boardDocument` | **板契约**：snapshot / prepare / pack / load | ~140 行 + 单测 |

MCP / 保存打开路径：`boardIO` → `packBoardSnapshotToText` / `importBoard` → `loadBoardIntoRuntimeFields`。

### 自动测试扩网（P0 + P1，~103 条 / 22 文件）

| 级别 | 已补 |
|------|------|
| **P0** | pack→open 全链路；import 后 stack 原子 z；blob 回收；itemPatch；嵌套复制 id（I10） |
| **P1** | jointSelection；selectionBounds/group scale；I1/I2 结构检测；enter/silent exit；selectStacks dirty |
| **修 bug** | `prepareBoardForRuntime` 改为**先内层后 root** reflow，避免打开后 stack fan 仍交错 |

I1–I10 中 I4（完整 exit 动画帧）仍主要靠 silent exit characterization + 手测；其余实质覆盖。

当前建议习惯：

1. 改完 → `npm run check`  
2. 发版 → 清单 P0  
3. 修 bug → 尽量加一条会失败的自动检查再修  
