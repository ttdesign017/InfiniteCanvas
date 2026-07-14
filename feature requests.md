# feature requests_260714

## Solved

- [x] 增加ctrl+F沉浸式模式，左右两侧的工具栏完全隐藏（要有淡入淡出动画）。鼠标hover到右下角有一个icon可以toggle的icon，类似缩放全屏的icon，功能与快捷键一致。沉浸模式下，选中项目时顶部的工具栏还在，只是两侧的工具栏不显示
- [x] 双击 stack 进入 / 双击标签改名；进出丝滑动画；内层 free 布局与 viewport 保留；左上角路径 `Home / …`；stack 可嵌套（`StackRecord` + `containerId` + `stackPreview`）
  - 嵌套 A⊃B：退出 A 时 B 作为原子 unit 参与 gather；外框 pad 含全部叶子；B 的 free 位姿在 A 内保留
  - 退出时冻结表面 z-order；选中/抬升 stack 整树连续 z，避免 B 被压到 free 元素下
  - 路径在 exit 动画开始即切到目标容器（`targetContainerId`），不与 canvas handoff 绑死
  - embed iframe keep-alive，跨 stack 导航不重载
  - 折叠 pile 上预览不可单独选中/移动

## Todo

- [ ] 多图缩放
- [ ] 音频支持
- [ ] 元素旋转支持
