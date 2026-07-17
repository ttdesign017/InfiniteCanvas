# Codex + IC2：画布铺板话术

配套通用 Skill：`skills/ic2-moodboard`（`~/.codex/skills/ic2-moodboard`）。

Skill **不绑定品牌调研**——头脑风暴、视觉收集、竞品图墙、行程板、会议墙等都适用。  
下面品牌句只是**一种**用户说法示例。

## 前置

1. 启动 **Infinite Canvas 2**  
2. MCP `ic2` + 写权限  
3. Skill **ic2-moodboard** 已安装  

## 通用用户句

> 把这些内容用 ic2 自由铺到画布：分区 sections、标题/关键词用大胆浮动大字（可调 fontSize），正文 note，真图进 images，链接 annotation 写在卡片上方，进 stack 后不要退出。

## 品牌视觉（可选示例，勿写进 skill 模板）

> 调研某品牌视觉时，同样用 mood board skill：分定位/色彩/产品等 section，色号写成 `#RRGGBB 名称` 自动上色。

## Agent 要点

1. `ic2_status` → live  
2. 内容要够深，禁止空壳  
3. `ic2_add_research_cluster`：`layout: mood`、`enterStack: true`、`sections[]`  
4. 字号按重要性加码（title 56–80、keyword 32–56）  
5. `list_items(createdStackIds[0])` 自检  
6. 用户 Ctrl+S；不主动 exit stack  
