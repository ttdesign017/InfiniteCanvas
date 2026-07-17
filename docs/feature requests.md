# feature requests / backlog

Last aligned with codebase: **2026-07-15** (see also `CODE_REVIEW.md`, `README.md`).

## Solved

- [x] 增加 Ctrl+F 沉浸式模式，左右两侧工具栏完全隐藏（淡入淡出）。鼠标 hover 到右下角可 toggle（类似缩放全屏 icon），功能与快捷键一致。沉浸模式下选中项目时顶部工具栏还在，两侧不显示
- [x] 双击 stack 进入 / 双击标签改名；进出丝滑动画；内层 free 布局与 viewport 保留；左上角路径 `Home / …`；stack 可嵌套（`StackRecord` + `containerId` + `stackPreview`）
  - 嵌套 A⊃B：退出 A 时 B 作为原子 unit 参与 gather；外框 pad 含全部叶子；B 的 free 位姿在 A 内保留
  - 退出时冻结表面 z-order；选中/抬升 stack 整树连续 z，避免 B 被压到 free 元素下
  - 路径在 exit 动画开始即切到目标容器（`targetContainerId`），不与 canvas handoff 绑死
  - 多层 breadcrumb 跳转（如 C→A）按层链式 exit（`pendingNavigation`），保证每层 fan 正确折叠
  - embed iframe keep-alive，跨 stack 导航不重载
  - 折叠 pile 上预览不可单独选中/移动
- [x] 拖放导入媒体 / URL / 文本；桌面原生 drop 与浏览器 parity
- [x] 链接书签卡片 + X / YouTube 等预览增强；保存 `.icanvas` 可内嵌媒体
- [x] 关闭 / Ctrl+Q 未保存提示（应用内对话框，避免 native ask 死锁）
- [x] 画布内 Ctrl+X/C/V 剪贴板（含 stack 子树重映射）

## Product todo

- [x] 多图缩放（多选统一缩放）
- [ ] 音频支持（独立音频 item / 播放器）
- [x] 元素旋转支持（UI + 持久化；类型字段已有 `rotation`，交互未完整）
- [ ] Ctrl+G 将已选 **stack 文件夹** 作为原子 unit 一并嵌套进新 stack
- [ ] 图片视频反转操作
- [ ] 窗口置顶、透明度
- [ ] 套索选择
- [ ] 检索增强

## Engineering fixes (from code review)

Priority roughly P0 → P2. Full write-up: `CODE_REVIEW.md`.

### P0 — Correctness / UX

- [x] Late Alt-drag duplicate：在 `move` 路径用 `getState().items` 重建 origins（与 `pending-move` 一致）
- [x] 文本 / Note 编辑：`useHistoryOnce` 在首次改字 / 清 placeholder 时打快照
- [x] 样式面板改色/字号：`useHistoryOnce` 每手势一次 `pushHistory`
- [x] 自动链接预览 `updateItem(..., { dirty: false })`；用户改 URL `{ history: true }`
- [x] `importBoard` 清除 `animating` / `pendingNavigation`
- [x] 架构：`store/types.ts` + `itemPatch.ts` + `ItemPatchOptions`；历史/脏标记与文档补丁解耦

### P1 — Persistence / dirty

- [x] 选中抬升 z-order：z 真正变化时标 `dirty`（保存后保留叠放）
- [x] 保存校验：`assertICanvasIntegrity`（items / stacks / asset 引用）
- [x] 解析 `.icanvas` 体积上限（`ICANVAS_MAX_TEXT_BYTES`）

### P2 — Security / performance

- [x] 收紧 CSP；asset / FS scope 改为 `$HOME` 与常见用户目录（非全盘 `**`）
- [x] Embed sandbox：去掉 top-navigation / popups-to-escape；paste 时剥离危险 token
- [x] History clone 共享媒体字符串（`cloneDocument.ts`）
- [x] blob URL 跟踪与回收（删除/换板/历史挤出后，且不影响 undo）
- [x] 移除未使用的 `@tauri-apps/plugin-shell`
- [x] 对齐版本号 npm / Tauri → `1.0.0`

> 注：FS/asset 不再 `**` 后，从非用户目录盘符（如部分 `D:\` 路径）拖入媒体可能需复制到文档/图片目录，或后续再做 dialog scope 动态授权。

## Notes

- 浏览器 `npm run dev` 无法走原生保存/打开对话框与 Rust 链接预览；完整能力需 `npm run tauri dev` / 打包版。
- 窗口 blur 会清空应用内剪贴板（便于外部复制优先）；若多窗口拷贝 stack 易丢缓冲，见 review suggestion #15。
