# IC2 创意灵感白板竞品调研

> 调研日期：2026-07-15  
> 产品简称：Infinite Canvas 2（IC2）  
> 信息口径：优先使用产品官网、官方帮助中心与官方应用商店；价格均为官网展示的美元标价，不含税，可能因地区和账期变化。  
> 本文基于当前仓库代码、README 和 `feature requests.md` 所体现的能力，而非仅依据产品设想。

## 1. 结论摘要

IC2 最有机会占据的不是“又一个通用在线白板”，而是：

**面向 Windows 创意工作者的本地优先灵感画布，把 PureRef 的低摩擦素材铺排、Allume 的嵌套思考和更丰富的媒体/网页内容放在同一个轻量桌面应用中。**

这个定位有三个现实支点：

1. **Allume 的结构最接近 IC2，但只覆盖 Apple 生态。** 它证明了“嵌套白板 + 卡片 + 墨迹 + 本地优先同步”可以成为独立付费产品；IC2 已经实现嵌套 stack、路径导航和多媒体画布，在 Windows 上存在明显空位。
2. **PureRef 是 IC2 最直接的操作体验标杆。** 它在素材导入、置顶、窗口行为、批量排版、裁切、旋转和大图性能上非常成熟，但笔记、网页链接、视频、嵌套空间和知识组织不是核心。IC2 可以覆盖“参考板之后的思考阶段”。
3. **通用协作白板已经高度拥挤。** Freeform、Microsoft Whiteboard、Miro 在协作、模板、形状、会议和生态集成上具有结构性优势。IC2 不宜早期正面复制，而应先把离线可靠性、素材处理速度、深层组织和个人创作体验做到极致。

最值得优先补齐的不是 AI 或多人协作，而是四项基础能力：

- 可靠且可恢复的项目文件（原子保存、素材完整性检查、备份/恢复）。
- 多图批量缩放、旋转、音频与 PDF。
- 搜索/大纲/快速跳转，以及素材来源信息。
- 大型图片板的内存、缩略图和文件体积治理。

## 2. IC2 当前产品画像

### 2.1 已实现能力

根据仓库实现，IC2 当前具备：

- Windows 原生桌面壳（Tauri 2 + WebView2），无边框、沉浸模式、右键拖动窗口。
- 无限画布：平移、缩放、适配全部内容。
- 图片、GIF、视频、文本、笔记卡、链接预览、iframe 嵌入。
- 手绘与橡皮擦。
- PureRef 风格的 `C + 拖动` 图片裁切。
- 元素多选、复制/剪切/粘贴、Alt 拖动复制、吸附、对齐与紧密排布。
- 可进入的嵌套 stack、面包屑导航、stack 内 viewport 记忆和进出动画。
- `.icanvas` 本地项目文件，素材以 base64 打包以支持离线打开。
- Undo/redo、关闭前未保存提醒、链接元数据抓取。

### 2.2 已知待办与边界

仓库现有待办明确列出：

- 多图缩放。
- 音频支持。
- 元素旋转。

与竞品相比还缺少或较弱的能力包括：

- PDF 阅读/批注、文档预览、图片 OCR。
- 全局搜索、标签、来源/版权信息、侧边大纲或资源库。
- 导出 PNG/PDF、演示/幻灯模式。
- Always-on-top、鼠标穿透、窗口透明度等 PureRef 工作流。
- 浏览器采集扩展或收件箱。
- 云同步、跨设备和多人协作。
- 模板、连接线、形状库、评论、版本历史。
- 自动保存、崩溃恢复、原子写入与项目素材优化。

## 3. 竞品全景矩阵

符号：`●` 强；`◐` 有但非核心或有限；`—` 无/不突出；`?` 官网未明确。

| 产品 | 主要定位 | 平台 | 本地优先 | 空间/嵌套组织 | 富媒体 | 素材管理 | 实时协作 | 价格概览 | 相对 IC2 的核心威胁 |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| IC2 | 个人创意灵感白板 | Windows | ● | ● | ● | ◐ | — | 未定 | 基准 |
| Allume（原 Muse） | 深度思考与视觉笔记 | Mac/iPad/iPhone | ● | ● | ● | ◐ | ● | 免费；Unlimited $9.99/月或 $99.99/年 | 定位与嵌套结构最接近 |
| PureRef | 参考图与 moodboard | Win/Mac/Linux | ● | ◐ | 以图片为主 | ● | — | 个人弹性付费；商业版付费 | 素材操作效率和性能标杆 |
| Milanote | 创意项目视觉组织 | Web/桌面/移动端 | — | ● | ● | ◐ | ● | 免费；个人 $9.99/月（年付） | 创意工作流完整、采集与协作成熟 |
| Eagle | 本地设计素材库 | Win/Mac | ● | 文件夹/标签型 | ● | ● | ◐ | 30 天试用；$34.95 买断 | 长期素材收藏、检索与去重 |
| Apple Freeform | 系统级创意协作白板 | Mac/iPad/iPhone | ◐ | — | ● | — | ● | Apple 设备免费自带 | 免费、系统集成、文件类型与绘图能力 |
| Microsoft Whiteboard | 会议/教育协作白板 | Web/Win/iOS/Android/Teams | — | — | ◐ | — | ● | 免费账户可用；M365/Teams 集成 | Windows 分发、协作与企业生态 |
| Miro | 团队视觉协作平台 | Web/桌面/移动端 | — | ◐ | ● | ◐ | ● | 免费；Starter $8/人/月（年付） | 模板、协作、结构化工作流和 AI |
| Kosmik（已停止服务） | AI 视觉研究与内置浏览器 | Win/Mac | 曾支持 | ◐ | ● | ● | ● | 2026-05-31 停止服务 | 功能方向启发大，但也是经营风险样本 |

## 4. 逐产品对比

### 4.1 Allume（原 Muse）——最直接的定位竞品

- 官网：[allume.com](https://allume.com/)
- 官方更新：[Muse 更名为 Allume / 4.0 更新](https://allume.com/updates/)
- 定位：强调“比一页更深的思考”，以可无限嵌套的 board 组织卡片和素材。

主要功能：

- board 内可继续放 board，支持自然生长的嵌套空间。
- 文本、卡片、墨迹、图片、视频、PDF、网页链接和其他文件。
- Inbox 快速收集、搜索和快速跳转。
- PDF 阅读与批注、卡片间连接、PDF/PNG 导出。
- 本地优先数据和即时同步；Mac、iPad、iPhone 原生应用。
- 共享 workspace、实时光标、评论、跟随和模板。
- 4.0 加入设备端图片文字搜索，以及通过 MCP 连接 AI 助手。

价格（官网当前展示）：

- Free：2 个 workspace、每 workspace 100 张卡、小尺寸 board、每 workspace 1 位其他协作者。
- Unlimited：$9.99/月或 $99.99/年；大尺寸 board、无限 workspace/卡片/协作者。
- Setapp：$14.99/月；无限内容、最多 5 位协作者。

与 IC2 对比：

| 维度 | Allume | IC2 | 判断 |
|---|---|---|---|
| 核心结构 | 原生嵌套 board，产品心智成熟 | 已实现嵌套 stack 和路径导航 | IC2 技术方向正确，但需把 stack 从“高级功能”提升为产品叙事中心 |
| 平台 | Apple 生态 | Windows | IC2 最大差异化机会 |
| 采集与阅读 | Inbox、PDF、搜索、OCR | 拖放/粘贴、链接预览；无 PDF/搜索 | Allume 明显领先 |
| 自由度 | 主动限制复杂排版、无限缩放/旋转 | 更接近 PureRef，强调自由铺排 | IC2 更适合视觉素材密集型用户 |
| 协作/同步 | 成熟 | 暂无 | Allume 领先，但 IC2 早期不必追平 |
| 媒体与嵌入 | 文件与卡片丰富 | 视频和 iframe keep-alive 是特色 | IC2 的网页/动态媒体潜力更强 |

可借鉴但不宜照搬：

- 借鉴 Inbox、全局搜索、快速跳转和 PDF 批注。
- 借鉴“少而精”的工具哲学，不急于加入复杂格式和企业白板功能。
- 不照搬 Apple 手势优先交互；IC2 应把 Windows 鼠标、快捷键、多窗口与置顶工作流做深。

### 4.2 PureRef——最直接的操作体验竞品

- 官网：[pureref.com](https://www.pureref.com/)
- 功能手册：[PureRef 2.1 Handbook](https://www.pureref.com/handbook/features/)
- 图片与素材优化：[Images](https://www.pureref.com/handbook/images/)
- 下载与价格：[Download](https://pureref.com/download.php)

主要功能：

- 从电脑、剪贴板、浏览器或 URL 快速拖放/粘贴图片。
- Always-on-top、指定窗口上方、鼠标穿透、可调透明度、无干扰窗口。
- 图片裁切、旋转、缩放、归一化尺寸、对齐、分布、堆叠和自动排版。
- Note、Drawing、Group、Hierarchy、大纲式父子关系和 slideshow。
- 场景文件默认嵌入图片，也可改为引用外部文件。
- 图片分辨率下采样、格式转换、永久裁切和批量优化，用于降低内存与项目体积。
- Windows、macOS、Linux。

价格与授权：

- 个人/爱好/教育用途采用可调整金额的支持方式；官网允许先试用再支持开发。
- PureRef 2.x 商业使用需要 license。官网当前展示小型商业用途一次性 $49，以及团队年度订阅约 $8/席/月或月付 $10/席/月；具体选项以下载页身份选择后的结算为准。

与 IC2 对比：

| 维度 | PureRef | IC2 | 判断 |
|---|---|---|---|
| 图片操作 | 极成熟，批量整理和优化完整 | 已有裁切、对齐、紧密排布、stack | PureRef 明显领先；IC2 三个现有待办都是必要追平项 |
| 知识表达 | Notes/Drawings，但仍以图片为中心 | 文本卡、链接卡、视频、iframe、嵌套空间 | IC2 明显更强 |
| 长期组织 | 单场景 + hierarchy/group | 可进入的嵌套 stack | IC2 更有潜力承载复杂项目 |
| 工作伴随 | 置顶、穿透、透明度、灵活窗口 | 有无边框和沉浸模式，尚无置顶/穿透 | PureRef 是必须学习的桌面体验标杆 |
| 大素材性能 | 有图片管理、下采样和文件优化 | 直接 blob/data URL 与 base64 打包 | PureRef 显著领先，也是 IC2 当前技术风险 |

最值得抄作业的优先级：多图缩放 → 旋转 → always-on-top → 图片降采样/压缩 → hierarchy/search → 鼠标穿透与透明度。

### 4.3 Milanote——创意项目工作流竞品

- 官网：[milanote.com](https://milanote.com/)
- 产品能力：[Creative Techniques](https://milanote.com/product)
- 视觉笔记与采集：[Visual Note-Taking](https://milanote.com/product/note-taking)
- 价格：[Plans & Pricing](https://milanote.com/plans/)

主要功能：

- 灵活视觉 board，组合笔记、图片、视频、草图、链接、文件与任务列表。
- board/column/连接线等方式组织创意项目，覆盖 moodboard、storyboard、创意简报、写作、营销和设计。
- Web Clipper 从网页保存图片、文字、视频和链接。
- 内置图片库、模板、评论、分享与实时协作。
- 云端自动保存、跨设备同步、移动端快速采集。

价格：

- Free：100 个 notes/images/links、10 次文件上传、无限共享 board。
- 个人：$9.99/月（年付）或 $12.50/月（月付），无限内容与文件上传。
- Team：官网按团队规模报价，示例起点为 $49/月（年付）。

与 IC2 对比：

| Milanote 优势 | IC2 优势 | IC2 应对 |
|---|---|---|
| 采集扩展、模板、任务、评论和协作形成完整创意项目闭环 | 本地文件、离线、自由画布操作和动态媒体体验更原生 | 先做个人创作“更快、更私密”，再补 Web Clipper/Inbox |
| 跨端和零保存心智 | 用户拥有 `.icanvas` 文件 | 强化可移植、可恢复、无账号；把本地所有权写进定位 |
| 更结构化、适合项目管理 | 更自由，stack 可形成深层空间 | 避免加入过多看板/任务管理功能导致定位漂移 |

### 4.4 Eagle——素材收藏与检索竞品

- 官网：[eagle.cool](https://www.eagle.cool/)
- 商店与价格：[Eagle Store](https://eagle.cool/store)
- 组织功能：[Eagle Organize](https://en.eagle.cool/support/desktop/organize)

主要功能：

- 本地设计素材库，支持文件夹、标签、智能筛选、评分、批注、颜色等元数据。
- 浏览器扩展、网页图片采集、批量重命名、重复文件检查。
- 快速预览、检索和管理大量图片、设计文件、字体、视频、音频等素材。
- 插件/API/MCP 方向，Windows 与 macOS。

价格：

- 30 天全功能试用。
- $34.95 一次性买断，含未来更新；单 license 可激活 2 台 Windows/macOS 设备。

与 IC2 对比：

| Eagle 优势 | IC2 优势 | IC2 应对 |
|---|---|---|
| 大规模长期收藏、标签、搜索、去重、浏览器采集 | 空间化构思、画布关系、笔记、链接和嵌套 | 不把 IC2 做成完整 DAM；提供轻量标签/来源/搜索即可 |
| 文件库可跨项目复用 | 每个 `.icanvas` 是独立、可携带创作上下文 | 可增加“引用素材库/最近素材”，但仍以项目画布为中心 |
| 买断价格清晰，Windows 用户基础强 | 动态创作和故事化组织更强 | Eagle 的 $34.95 是 IC2 买断定价的重要锚点 |

### 4.5 Apple Freeform——系统自带创意白板

- 官网说明：[Apple Freeform](https://www.apple.com/newsroom/2022/12/apple-launches-freeform-a-powerful-new-app-designed-for-creative-collaboration/)
- App Store：[Freeform](https://apps.apple.com/us/app/freeform/id6443742539)

主要功能：

- 无限画布，支持照片、视频、音频、文档、PDF、网页链接、地图、便签、形状和扫描文档。
- 700+ 形状、对齐参考线、Apple Pencil 绘图、锁定和对象上批注。
- Quick Look 文件预览、多个视频同时播放。
- iCloud 同步，最多 100 人实时协作，Messages/FaceTime 集成。
- PDF 导出；支持 Mac、iPad、iPhone。

价格：支持相应系统版本的 Apple 设备免费自带。

与 IC2 对比：

- Freeform 在文件类型、绘图、形状、协作和系统采集上全面领先，而且免费。
- IC2 的机会不在 Apple 生态正面对抗，而在 Windows、本地项目文件、PureRef 式图片操作、网页嵌入和嵌套空间。
- 应把“无需账号、项目可携带、离线、多层 board、创意参考图效率”作为与系统白板的明确区隔。

### 4.6 Microsoft Whiteboard——Windows/Teams 系统生态竞品

- 官方入门：[Getting started with Microsoft Whiteboard](https://support.microsoft.com/en-US/whiteboard/getting-started-with-microsoft-whiteboard)
- 官方帮助中心：[Whiteboard Help](https://support.microsoft.com/en-us/whiteboard/)
- 账户说明：[Sign up for a new Whiteboard account](https://support.microsoft.com/en-US/whiteboard/sign-up-for-a-new-whiteboard-account)

主要功能：

- 无限数字画布，画笔、高亮、橡皮擦、套索、墨迹美化。
- 便签、文本、图片、形状、模板等基础白板对象。
- 分享链接与实时协作；Teams 会议、聊天和频道集成。
- Web、Windows、iOS、Android、Surface Hub。
- 适合会议、教学、冲刺规划和团队头脑风暴。

价格：可使用免费 Microsoft 账户登录；企业/学校能力与 Microsoft 365、Teams 许可体系结合，并非独立的创作者付费产品。

与 IC2 对比：

- Whiteboard 的护城河是身份、Teams、企业管理和实时协作，不是个人素材白板的深度。
- IC2 应避免追逐会议模板、投票、企业合规；更应该强调大图、视频、网页、离线、嵌套和窗口伴随工作流。
- 在 Windows 上，IC2 可以成为“创作者的私人工作台”，而 Whiteboard 是“团队会议房间”。

### 4.7 Miro——通用视觉协作平台

- 官网：[miro.com](https://miro.com/)
- 价格与完整功能对比：[Miro Pricing](https://miro.com/pricing/)

主要功能：

- 在线缩放白板、实时/异步协作、模板和分享。
- Sticky notes、绘图、图表、Docs、Tables、Timeline、Kanban、Slides。
- 计时器、投票、私密模式、演示、评论、访客编辑。
- 250+ 集成；高级图形库、流程/系统建模、原型与项目管理。
- AI 生成图表/表格/摘要、AI workflows/agents 和 MCP。

价格（年付口径）：

- Free：3 个可编辑 board、模板、基础结构化格式和有限 AI。
- Starter：$8/成员/月，无限私有 board、访客编辑、高分辨率导出、计时/投票等。
- Business：$20/成员/月，更多 workspace、guest、专业图形、数据表、原型和 AI。
- Enterprise：定制价格。

与 IC2 对比：

- Miro 在团队协作、模板、结构化工作流、集成、AI 和企业能力上不可正面追平。
- IC2 的优势是无需登录、离线、轻量桌面、素材直接性和更私密的个人思考空间。
- 产品文案应避免只写“infinite whiteboard”；应明确写成“local-first visual inspiration workspace for Windows”。

### 4.8 Kosmik——停止服务但高度相关的战略样本

- 官网及停止服务公告：[kosmik.app](https://www.kosmik.app/)
- 历史价格页：[Kosmik Pricing](https://www.kosmik.app/pricing)

Kosmik 曾提供：

- 视觉研究画布、内置多人网页浏览器、notes/bookmarks/files。
- 本地数据/设备端 IPFS 与多人协作探索。
- 自动标签、AI 搜索、无限 workspace/universe/items、文件导入和分享。
- Windows 与 macOS 客户端。

状态：

- 官网宣布于 **2026-05-31** sunset；目前不能新注册，只允许现有用户下载客户端并导出数据。
- 历史 Pro 价格为 $11.99/月（年付）或 $14.99/月（月付），但已经不再是可购买方案。

对 IC2 的意义：

1. 内置浏览器、自动标签和 AI 搜索证明“研究 → 收集 → 空间整理”是有吸引力的统一工作流。
2. 同时，它说明高基础设施成本的同步、多人、AI 和订阅并不能自动形成可持续业务。
3. IC2 的本地项目文件、低云成本和 Windows 单机切入更稳健；应保证即使未来加入云服务，核心文件仍可脱离服务独立打开。

## 5. 关键功能差距与机会

| 能力 | 竞品证据 | IC2 状态 | 建议优先级 |
|---|---|---|---:|
| 多图缩放与旋转 | PureRef 基础生产力 | 已列 Todo | P0 |
| 素材优化/缩略图 | PureRef 可下采样、转码、永久裁切 | 当前主要依赖 blob/data URL/base64 | P0 |
| 安全保存与恢复 | 本地工具的信任基础 | 有校验但非原子写入，打包失败可保留临时 URL | P0 |
| PDF 与音频 | Allume、Freeform、Milanote 支持 | 视频强，PDF/音频缺失 | P1 |
| 全局搜索/快速跳转 | Allume、Eagle、Kosmik 都强调 | 无 | P1 |
| 来源、标签、去重 | Eagle 核心优势 | 链接有元数据，图片缺来源模型 | P1 |
| Always-on-top/穿透/透明度 | PureRef 标志性能力 | 仅无边框/沉浸/拖窗 | P1 |
| PNG/PDF 导出 | Allume、Freeform、Miro、PureRef | 无明确出口 | P1 |
| Inbox/Web Clipper | Allume、Milanote、Eagle | 可粘贴/拖放，无异步收集入口 | P2 |
| 同步与协作 | Allume、Milanote、Freeform、Miro | 无 | P2/P3，验证付费需求后再做 |
| OCR/AI 检索 | Allume、Kosmik、Miro | 无 | P3，建立搜索与素材模型后再做 |

## 6. 推荐产品路线

### 阶段 A：把本地创作底座做可信（发布前）

- 原子保存：写临时文件、校验、替换正式文件；保留最近一次自动备份。
- 素材打包失败时禁止显示“Saved”；列出失败素材并允许定位/替换。
- 自动保存与崩溃恢复草稿。
- 引入缩略图、图片降采样/优化和项目体积报告。
- 收紧 Tauri 文件权限、asset scope 和 CSP。
- 为 board 文件解析、迁移、嵌套 stack、undo/redo 和保存失败加入自动化测试。

### 阶段 B：完成“PureRef + 深度组织”最小闭环

- 多选统一缩放、自由旋转/角度吸附。
- Always-on-top、窗口透明度、可选鼠标穿透。
- PDF、音频、PNG/PDF 导出。
- 侧边大纲 + 全局搜索 + 快速跳转。
- 图片来源 URL、备注、轻量标签；支持按来源/类型筛选。
- 将 stack 命名为用户能理解的“Board/Space”，在 onboarding 中突出 board-in-board。

### 阶段 C：强化灵感采集

- Windows Share Target 或浏览器扩展。
- Inbox：先收集、后整理；支持把内容拖入当前 board/stack。
- 重复图片提示、批量文件夹导入、最近素材。
- 可选本地 OCR，优先支持图片文字搜索，不急于生成式 AI。

### 阶段 D：验证商业化后扩展服务

- 优先做单人多设备同步，再做分享只读链接，最后才是实时协作。
- AI 以“检索、聚类、溯源、总结选中内容”为主，避免让 AI 取代空间思考。
- 云能力必须保持可选；`.icanvas` 应始终是可完整导出、可离线打开的用户资产。

## 7. 定位与定价建议

### 7.1 一句话定位候选

> **IC2 是 Windows 上本地优先的视觉灵感工作台：像 PureRef 一样快速收集和铺排素材，像 Allume 一样把想法层层展开。**

不建议使用过于宽泛的“无限白板”作为主定位，因为它会让用户直接拿 IC2 与 Miro、Freeform 和 Microsoft Whiteboard 的协作/形状/模板能力比较。

### 7.2 目标用户

首要：

- UI/视觉/游戏/影视创作者。
- 需要大量参考图、视频和网页素材的独立创作者。
- 使用 Windows、重视本地隐私和文件所有权的人。

次要：

- 研究者、写作者、内容策划与世界观构建者。
- 不喜欢线性笔记、又不需要企业协作套件的人。

### 7.3 商业模式建议

- **核心桌面版买断**：建议测试 $29–49 区间。Eagle 当前 $34.95、PureRef 小型商业一次性 $49，可作为 Windows 创意工具锚点。
- **可选订阅服务**：仅对同步、版本历史、分享和协作收费，例如 $4–8/月；本地单机能力不锁订阅。
- **免费试用**：14–30 天全功能，比限制 board 大小更适合检验性能和工作流。
- **教育/独立创作者优惠**：与 Allume/PureRef/Eagle 的用户心智一致。

## 8. 产品决策原则

1. **速度优先于功能数量。** 导入、拖动、缩放、裁切和保存必须在大图场景仍然顺畅。
2. **文件所有权是产品功能。** 不只是“离线可用”，还要可恢复、可迁移、可验证、无服务依赖。
3. **嵌套是核心差异，不是隐藏快捷键。** 需要在空状态、引导、命名和导航中被看见。
4. **个人创作优先于会议协作。** 不复制投票、计时器、企业模板等高拥挤功能。
5. **AI 必须服务于找回和连接。** OCR、搜索、相似素材、来源和聚类优先于生成白板内容。
6. **Windows 原生体验要成为壁垒。** 置顶、快捷键、文件关联、拖放、多窗口和低资源占用比跨平台口号更重要。

## 9. 主要官方来源

- Allume：[官网与价格](https://allume.com/)；[4.0 更新与更名](https://allume.com/updates/)
- PureRef：[官网](https://www.pureref.com/)；[Handbook](https://www.pureref.com/handbook/)；[Images/优化](https://www.pureref.com/handbook/images/)；[下载与价格](https://pureref.com/download.php)
- Milanote：[官网](https://milanote.com/)；[产品功能](https://milanote.com/product)；[视觉笔记](https://milanote.com/product/note-taking)；[价格](https://milanote.com/plans/)
- Eagle：[官网](https://www.eagle.cool/)；[商店](https://eagle.cool/store)；[组织功能](https://en.eagle.cool/support/desktop/organize)
- Apple Freeform：[Apple Newsroom](https://www.apple.com/newsroom/2022/12/apple-launches-freeform-a-powerful-new-app-designed-for-creative-collaboration/)；[App Store](https://apps.apple.com/us/app/freeform/id6443742539)
- Microsoft Whiteboard：[入门](https://support.microsoft.com/en-US/whiteboard/getting-started-with-microsoft-whiteboard)；[帮助中心](https://support.microsoft.com/en-us/whiteboard/)；[账户](https://support.microsoft.com/en-US/whiteboard/sign-up-for-a-new-whiteboard-account)
- Miro：[官网](https://miro.com/)；[价格与功能对比](https://miro.com/pricing/)
- Kosmik：[停止服务公告](https://www.kosmik.app/)；[历史价格](https://www.kosmik.app/pricing)

