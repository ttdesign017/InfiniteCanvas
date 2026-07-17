---
name: ic2-moodboard
description: >
  Compose freeform spatial boards on Infinite Canvas 2 via the ic2 MCP:
  research dumps, brainstorms, visual collections, trip plans, competitive maps,
  design refs, meeting walls — any mixed-media canvas work.
  Supports progressive streaming writes (section-by-section) and multi-agent
  research → writer queues. Triggers: mood board, 画布, Infinite Canvas,
  ic2_add_research_cluster, ic2_append_cluster, spatial notes, 铺到画布.
---

# IC2 Free Canvas / Mood Board

Use **ic2** MCP to place content as a **spatial composition** inside a stack the user can watch fill — not a document dump.

Applies to **any topic**. Do not hard-code a brand or vertical.

## Preconditions

1. `ic2_status` → prefer `mode: live`.
2. Write allowed.
3. Remind **Ctrl+S** when done.

---

## Progressive appearance (preferred)

Live bridge applies **each MCP call immediately**. Do **not** wait until all research is finished to write once.

### Pattern A — single agent, stream by section

1. **Open shell** (user sees empty stack right away):

```json
{
  "title": "Topic board",
  "clientRequestId": "stack_topic_v1",
  "enterStack": true,
  "notes": [
    { "role": "title", "content": "Topic", "fontSize": 64 }
  ]
}
```

Save `stackId` from `createdStackIds[0]` (or reuse `clientRequestId`).

2. As soon as **one theme** is ready, **append** it:

```json
{
  "stackId": "stack_topic_v1",
  "enterStack": true,
  "sections": [
    {
      "heading": "Theme A",
      "notes": [{ "role": "body", "content": "…" }],
      "images": [{ "url": "https://…" }],
      "links": [{ "url": "https://…", "annotation": "why" }]
    }
  ]
}
```

Use `ic2_append_cluster` or `ic2_add_research_cluster` with `stackId` / same `clientRequestId`.  
New content is placed **below** existing items.

3. Repeat for Theme B, C, … until done. **Stay inside the stack.**

### Pattern B — multi-agent: research workers + canvas writer

Use when research can run in parallel (subagents).

```
┌─────────────┐  section JSON   ┌──────────────────┐  MCP append   ┌─────────┐
│ Research A  │ ───────────────► │                  │ ─────────────► │  IC2    │
├─────────────┤                  │  Canvas Writer   │                │  live   │
│ Research B  │ ───────────────► │  (queue drain)   │ ─────────────► │  stack  │
├─────────────┤                  │                  │                └─────────┘
│ Research C  │ ───────────────► └──────────────────┘
└─────────────┘
```

**Writer agent (orchestrator or dedicated):**

1. `ic2_status` → live  
2. Open shell stack (`clientRequestId` fixed for the job)  
3. Maintain an in-memory **queue** of completed section payloads from workers  
4. **As soon as a queue item arrives**, call `ic2_append_cluster` — do not wait for all workers  
5. Drain until workers report done **and** queue is empty  
6. Optional final polish pass; remind Ctrl+S  

**Research workers:**

- Do **not** call MCP write tools (avoids races / mixed layout).  
- Return structured JSON only:

```json
{
  "heading": "…",
  "notes": [{ "role": "keyword|body|…", "content": "…", "fontSize": 40 }],
  "images": [{ "url": "https://…direct…" }],
  "links": [{ "url": "https://…page…", "annotation": "…" }]
}
```

- One section (or small batch) per completion message.  
- Prefer direct image URLs; never put image files in `links`.

**Orchestrator prompt sketch:**

> Open an IC2 stack with a hero title. Spawn research subagents for themes […].  
> As each returns a section, the writer immediately `ic2_append_cluster`s it.  
> Do not buffer until the end.

### Why this works

| Mechanism | Behavior |
|-----------|----------|
| Live agent bridge | Each MCP mutation paints on the open window |
| `stackId` / stable `clientRequestId` | Same stack, append below |
| `enterStack: true` | User stays inside and watches growth |
| One section per call | Earlier themes appear before slow ones finish |

There is **no** true multi-writer concurrent merge on one stack — **one writer** serializes the queue (safe).

---

## Media rules

| Content | Field | Never |
|---------|--------|-------|
| Photos | `images[]` / `ic2_import_image_url` | Image URLs in `links[]` |
| Pages | `links[]` + `annotation` | Agent essay as link `title` |
| Titles / keywords | `role: title\|subtitle\|keyword` + bold `fontSize` | All body notes |
| Long prose | `role: body` | Everything as giant titles |

Hex in text (`#1D1D1B Name`) → auto text color.

## Typography — bold by importance

| Role | Suggested `fontSize` |
|------|----------------------|
| `title` | 56–80 |
| section heading / `subtitle` | 32–48 |
| `keyword` | 32–56 (top 1–3 even larger) |
| `body` | ~15 (auto height) |

## Layout

Server `layout: "mood"`: free section bands, alternating bias, not a spreadsheet.  
Prefer `sections[]` so related media stays together. Fine-tune later with `ic2_create_text` / `import_image_url` / `move_items`.

## Anti-patterns

- One giant cluster only after all research finishes  
- Multiple agents writing MCP in parallel to the same stack  
- Image URLs in `links`  
- Tiny floating text  
- `get_item(stackId)` — use `get_stack` / `list_items(stackId)`  

## Example user asks

> 边调研边铺画布，完成一块写一块。  
> 用 subagent 分主题调研，一个 writer 队列写入 IC2。  
> 先开 stack 大标题，再按 section 追加图片和笔记。
