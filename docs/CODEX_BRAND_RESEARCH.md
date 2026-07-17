# Codex + IC2：品牌视觉调研话术

## 前置

1. 启动 **Infinite Canvas 2**（建议新空白板或副本，勿直接写生产板）。  
2. Codex MCP `ic2` 已配置，`IC2_MCP_ALLOW_WRITE=1`。  
3. Codex 具备联网/浏览器能力（用于搜资料与找图）。  

## 推荐用户句

> 帮我调研一下 Songmont 的品牌视觉，一边搜一边用 ic2 MCP 铺到当前画布上。用 `ic2_add_research_cluster`，标题 Songmont 品牌视觉，包含定位摘要、色彩/材质笔记、官网与社媒链接、3～6 张参考图 URL。

## Agent 建议步骤

1. `ic2_status` — 确认 `mode: live`  
2. `ic2_get_viewport` — 可选，用于落在可见区域  
3. 网页调研（品牌定位、色调、材质、竞品、官方图）  
4. **一次或多次** `ic2_add_research_cluster`：  
   - `notes`: 定位、色彩关键词、字体/气质  
   - `links`: 官网、旗舰店、关键报道  
   - `images`: 可公开访问的 https 图片 URL  
5. 需要时再 `ic2_create_note` / `ic2_layout_grid` 微调  
6. 提醒用户在 IC2 里 **Ctrl+S** 保存  

## 勿做

- 无 live 时不要假设用户看得见（会落文件 session）  
- 不要把整页 base64 塞进对话；图用 URL 交给 `import` / cluster  
- 不要批量删除用户已有内容  
