# Code Review — InfiniteCanvas2

**Date:** 2026-07-15  
**Scope:** Full codebase (main + uncommitted store/keyboard navigation fixes)  
**Typecheck:** `tsc --noEmit` passes

## Summary

InfiniteCanvas2 is a capable PureRef-like desktop canvas (Tauri 2 + React 19 + Zustand) with solid nested-stack animation, portable `.icanvas` packing, and thoughtful SSRF mitigations on link previews. The highest risks are **over-broad desktop capabilities** (world FS scope, null CSP, open asset protocol), **embed iframe sandbox holes**, and **correctness gaps** in undo/history, dirty tracking, late Alt-drag duplicate, and import mid-animation. Architecture concentrates logic in a ~3700-line store and ~2200-line canvas surface, which raises regression risk as stacks and I/O grow.

---

## Issues by severity

### Bugs

| # | Area | Problem | Suggested fix |
|---|------|---------|----------------|
| 1 | `src-tauri/capabilities/default.json` | FS scope `**` / `**/*` + read/write file perms → renderer can touch any path the process can access | Scope to documents/downloads/app data, or grant paths only after dialog pick |
| 2 | `src-tauri/tauri.conf.json` | `"csp": null` and `assetProtocol.scope: ["**"]` remove WebView barriers | Ship a strict CSP; narrow asset roots |
| 3 | `src/utils/embedIframeCache.ts`, `embed.ts` | Sandbox combines `allow-scripts` + `allow-same-origin` + popups + top-nav for arbitrary pasted embeds | Host allowlist; drop same-origin / top-navigation unless required |
| 4 | `InfiniteCanvas.tsx` ~913 | Late Alt-drag duplicate rebuilds origins from **stale** `store.items` after `duplicateItems` (pending-move path correctly uses `getState()`) | Use `useCanvasStore.getState().items` after duplicate |
| 5 | `TextCardView` / `TextItemView` | Typing calls `updateItem` with **no** `pushHistory` → Ctrl+Z does not undo note text | Push history on edit start / first change; commit on blur |
| 6 | `useCanvasStore` `select` / `selectStacks` / `selectBodies` | Raise-on-select rewrites `zIndex` without `dirty` → order lost on quit without save prompt | Mark dirty when z maps change, or keep raise ephemeral |
| 7 | `importBoard` | Does not clear `animating` / `pendingNavigation` → open board mid-anim can lock UI | Reset both; consider RAF generation counter |
| 8 | `LinkCardView` auto-preview | `updateItem` always sets `dirty` → opening a clean board can mark dirty with no user edit | Non-dirtying patch path for automatic metadata |

### Suggestions

| # | Area | Problem | Suggested fix |
|---|------|---------|----------------|
| 9 | `lib.rs` link preview | SSRF checks are strong; residual DNS rebinding TOCTOU between resolve and connect | Pin resolved IPs / re-check at connect |
| 10 | History | Up to 50 full `structuredClone`s of all items (incl. multi-MB `data:` media) | Reverse patches / share media by id; lower cap |
| 11 | `media.ts` / drops | `createObjectURL` without `revokeObjectURL` on delete/import | Track and revoke blob URLs per item |
| 12 | `StyleInspector` | Style changes dirty but not undoable | `pushHistory` once per style batch |
| 13 | `boardFile` / `boardIO` | No max file size on parse; save verify only compares item counts | Size guard; verify stacks + asset refs |
| 14 | `quickStack` | Selected stack folders ignored in Ctrl+G | Document, or treat folders as atomic bodies |
| 15 | `useKeyboard` blur | Clears in-app clipboard on window blur | Clear only on OS clipboard change, or document |

### Nits

| # | Area | Problem |
|---|------|---------|
| 16 | `package.json` | `@tauri-apps/plugin-shell` listed but not used in Rust/capabilities |
| 17 | Version drift | npm `0.1.0` vs Tauri/Cargo `1.0.0` |
| 18 | Save verify | Stack count / asset integrity not checked after write |

---

## Architecture notes

| Layer | Tech (as of review) |
|--------|---------------------|
| Shell | Tauri 2.11, WebView2 (Windows) |
| UI | React 19.1 + TypeScript 5.8 + Vite 7 |
| State | Zustand 5 (~3700-line god store) |
| Plugins used | dialog, fs, opener |
| Unused dep | plugin-shell (frontend package only) |

**Strengths**

- Nested enterable stacks with fan/free pose split (`stackPreview`, `freeFanRel`, `containerId`)
- Enter/exit morph, peer fade, path switch via `targetContainerId`; multi-level exit chaining (`pendingNavigation`)
- Embed iframe keep-alive across stack navigation
- PureRef-style C-drag crop; snap / align / pack
- Portable `.icanvas` format v3 with embedded base64 assets
- Dirty-aware close with in-app dialog (avoids native `ask` deadlock on close)
- Link previews: SSRF host/IP checks, X + YouTube providers, image as data URL

**Smells**

- **God store** — history, selection, layout RAF, nest/dissolve, clipboard, board fields, stack enter/exit
- **Monofile canvas** — hit-test, drag/resize/crop/marquee, DnD, stack chrome in one component
- Utils (`stacks`, `zOrder`, `layout`, `boardFile`, `dropImport`) are better factored

**Suggested direction:** slice the store (document / selection / navigation / history); move enter/exit RAF to a dedicated controller; keep geometry pure in utils.

---

## Uncommitted work (at review time)

Working tree had fixes not yet committed:

- Multi-level stack exit always exits one parent at a time, then chains via `pendingNavigation`
- Empty-stack exit path without animation
- Undo/redo clears edit + anim state
- Window blur clears in-app clipboard

These look directionally correct for nested gather stability; still verify deep breadcrumb jumps (C→A) under load.

---

## Priority fix order (recommended)

1. ~~Alt-drag stale origins~~ **Done**  
2. ~~Text/style history + auto-preview dirty~~ **Done**  
3. ~~`importBoard` anim lock~~ **Done**  
4. ~~Embed sandbox / CSP / FS scope~~ **Done**  
5. ~~Blob revoke + history media share~~ **Done**  
6. ~~Raise-on-select dirty~~ **Done**  

## P0 landed (2026-07-15)

### Architecture

| Module | Role |
|--------|------|
| `src/store/types.ts` | `HistoryEntry`, `StackEnterAnim`, `ItemPatchOptions` (out of god-store) |
| `src/store/itemPatch.ts` | Pure `applyItemPatch` / `applyItemPatches` (no Zustand) |
| `src/hooks/useHistoryOnce.ts` | One undo snapshot per edit/gesture session |
| `updateItem` / `updateItems` | Optional `{ dirty?, history? }` — auto metadata can skip dirty |

### Fixes

| Issue | Change |
|-------|--------|
| #4 Alt-drag | Late duplicate origins from `getState().items` |
| #5 Text history | `useHistoryOnce` on first keystroke / placeholder clear |
| #12 Style history | Style panels call `pushHistoryOnce` before apply batch |
| #8 Link dirty | Auto preview + image proxy use `{ dirty: false }`; URL commit uses `{ history: true }` |
| #7 importBoard | Clears `animating` + `pendingNavigation` |

## P1 / P2 landed (follow-up)

| Area | Change |
|------|--------|
| Select z dirty | `select` / `selectStacks` / `selectBodies` set `dirty` when z maps actually change |
| Save verify | `assertICanvasIntegrity` — magic, item/stack counts, packed asset refs |
| Parse cap | `ICANVAS_MAX_TEXT_BYTES` (~512 MiB) before `JSON.parse` |
| CSP | Non-null policy in `tauri.conf.json` |
| FS / asset scope | `$HOME` + user dirs (not `**`) |
| Embed sandbox | No top-nav / popups-to-escape; paste strips those tokens |
| History memory | `cloneItemsForHistory` shares media string refs |
| Blob URLs | `blobUrls.ts` track + revoke when unreachable from live+history |
| shell dep | Removed; npm version aligned to `1.0.0` |
}
