# Board Operations

> Domain API for Infinite Canvas 2 — shared by the desktop UI and future MCP.  
> **Code:** `src/board-ops/`  
> **MCP surface plan:** `docs/MCP.md`  
> **API version:** `BOARD_OPS_API_VERSION` in `src/board-ops/dto.ts` (currently **1**)

---

## 1. Why this layer exists

| Without board-ops | With board-ops |
|-------------------|----------------|
| UI, file I/O, and Agent each invent list/get/create | One pure API over `BoardView` / `BoardSnapshot` |
| Tool results might dump full `CanvasItem` + media | **DTOs** omit base64 / blob URLs |
| `alert` / dialogs mixed into open/save | **fileOps** throw `BoardOpsError`; UI maps to toast |

**Rule:** MCP and new automation call `board-ops` only. They do **not** import React, Zustand hooks, or `boardIO` dialogs.

---

## 2. Module map

```
src/board-ops/
  index.ts       Public exports
  errors.ts      BoardOpsError + codes
  dto.ts         Agent-safe types + apiVersion
  types.ts       BoardView, queries, mutation results
  project.ts     CanvasItem → DTO
  read.ts        meta / list / get / tree / export_text / search
  write.ts       createNote / updateText / moveItems / batch
  fileOps.ts     load/save path (no UI)
  __tests__/
```

| Layer | Module | Side effects |
|-------|--------|----------------|
| Pure read/write | `read`, `write`, `project` | None |
| File | `fileOps` | Disk via `desktop.ts` |
| UI | `utils/boardIO.ts` | Dialogs, `alert`, store import |

---

## 3. Core types

### `BoardView`

Minimal document handle (from snapshot):

- `name`, `items`, `stacks`, `viewport`, `homeViewport?`, `nextZ`, `currentContainerId`

Convert:

- `boardViewFromSnapshot(snap)`
- `snapshotFromBoardView(view)` — for pack/save

### DTOs (never full media)

- `ItemSummaryDto` / `ItemDetailDto` — pose, label, optional `media: { hasMedia, fileName, srcKind }`
- `StackTreeNodeDto` — nested stack tree
- `BoardMetaDto` — counts + `apiVersion`

### Errors

```ts
throw new BoardOpsError('ITEM_NOT_FOUND', 'Item not found: …', id)
```

| Code | When |
|------|------|
| `BOARD_TOO_LARGE` | File over cap |
| `PARSE_FAILED` / `NOT_ICANVAS` | Bad file |
| `ITEM_NOT_FOUND` / `STACK_NOT_FOUND` / `CONTAINER_NOT_FOUND` | Bad ids |
| `INVALID_PATCH` / `WRITE_DENIED` | Bad write |
| `SAVE_FAILED` / `OPEN_FAILED` | I/O |
| `DRY_RUN` | Reserved |

UI: `formatBoardError(err)`. MCP: `boardErrorToJson(err)`.

---

## 4. Container semantics (explicit)

**All list/export queries take `containerId`.**  
Use `root` for the home canvas (`ROOT_CONTAINER_ID`).  
Do **not** rely on “whatever the UI is viewing” inside pure ops — live adapters may pass `currentContainerId` **explicitly**.

```ts
listItems(board, { containerId: 'root', limit: 50 })
listItems(board, { containerId: someStackId, type: 'textcard' })
exportText(board, { containerId: 'root' })
buildStackTree(board, { containerId: 'root', depth: 4 })
```

---

## 5. Read API

| Function | Purpose |
|----------|---------|
| `getBoardMeta(board)` | Name, counts, viewport, apiVersion |
| `listItems(board, { containerId, type?, limit?, offset? })` | Summaries in one container |
| `getItem(board, { id })` | Detail (text content; no media bytes) |
| `buildStackTree(board, { containerId?, depth? })` | Nested stacks |
| `exportText(board, { containerId, ids?, maxCharsPerItem? })` | LLM-friendly text blocks |
| `searchItems(board, { query, containerId?, type?, limit? })` | Substring search |

---

## 6. Write API (restricted)

| Function | Purpose |
|----------|---------|
| `createNote(board, input, { dryRun? })` | textcard (default) or free text |
| `createNotesBatch(board, notes[], opts)` | Multiple notes, **one** mutation result |
| `updateText(board, { id, content?, style… })` | Whitelist fields only |
| `moveItems(board, { moves: [{ id, x?, y?, rotation? }] })` | Absolute pose; rejects locked |

### History / undo contract

| Rule | Meaning |
|------|---------|
| **One write call → one undo unit** | When applying to the live store, call `pushHistory()` **once** then replace items from `result.board` |
| **`dryRun: true`** | Returns next board for inspection; caller must not save or push history |
| **`clientRequestId`** | Idempotent create: same id → no duplicate |
| **No silent media replace** | v1 cannot set image/video `src` via updateText |

Applying a mutation live (sketch):

```ts
const result = createNotesBatch(boardViewFromSnapshot(store.exportBoard()), notes)
if (result.dryRun) return
store.pushHistory() // once for the batch
// map result.board → store set (items, nextZ, …) or import thin patch
```

---

## 7. File API

| Function | Purpose |
|----------|---------|
| `loadBoardSnapshotFromPath(path)` | Parse `.icanvas` → `BoardSnapshot` (packed assets as refs) |
| `loadBoardViewFromPath(path)` | Same → `BoardView` |
| `saveBoardSnapshotToPath(snapshot, path)` | Pack + atomic write + size verify |
| `saveBoardViewToPath(board, path)` | Via snapshot |

Runtime open still uses `importBoard` / `prepareBoardForRuntime` so blobs hydrate **after** revoke.

`utils/boardIO.ts` is the UI façade: dialogs + alert + store.

---

## 8. Testing

```bash
npm run test   # includes src/board-ops/__tests__
```

Focus: tree nesting, container isolation, DTO media safety, batch create, dryRun, error codes.

---

## 9. What is intentionally out of scope (v1)

- Delete / dissolve stack / Ctrl+G nest  
- Auto layout apply without confirm  
- Live selection / navigate (MCP Phase live)  
- Returning base64 or `blob:` URLs in DTOs  
- Embed HTML mutation  

---

## 10. Evolution

1. Grow write whitelist carefully; bump `BOARD_OPS_API_VERSION` on breaking DTO changes.  
2. Live backend adapter: `LiveBoardBackend` wrapping store actions.  
3. MCP package only maps tools → these functions.
