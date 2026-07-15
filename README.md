# Infinite Canvas 2 (Tauri)

PureRef-inspired infinite canvas for Windows — **Tauri 2 + React + TypeScript** rewrite of [InfiniteCanvas](../InfiniteCanvas) (Electron). Same reference-board workflow, much smaller binary (system WebView2 instead of bundled Chromium).

| | |
|--|--|
| Product version | `1.1.0` (npm · Tauri · Cargo) |
| Frontend | React 19 · TypeScript 5.8 · Vite 7 · Zustand 5 |
| Shell | Tauri 2 · plugins: **dialog**, **fs**, **opener** |
| Board format | `.icanvas` formatVersion **3** (JSON + embedded base64 assets) |

> Local-only notes (gitignored under `docs/`): architecture writeups, code reviews, feature backlog.

## Features

### Canvas & navigation

- **Infinite canvas** — pan (middle mouse / Space+drag), zoom (wheel / Ctrl+/-), fit all content (**F** or **Ctrl+0**)
- **Immersive mode (default on)** — side docks hidden; **Ctrl+F** toggles; corner control; top style bar still shows for selection
- **Frameless window** — minimal chrome (hover top-right); right-drag moves the window; **Ctrl+Q** quits with Save / **Discard** / Cancel
- **Breadcrumb** — `Home / … / current`; multi-level jumps play **one** exit morph, then silently fold intermediate stacks so fans stay correct

### Content types

- **Media** — images, GIF, video (custom player: play control + hover progress scrubber)
- **Notes & free text** — Notion-style cards; free-floating text with color / font / size / background
- **Links** — bookmark cards with OG/Twitter previews (desktop: Rust fetch + X/YouTube providers; SSRF mitigations); **double-click** opens externally
- **Embeds** — iframe apps stay mounted across stack navigation (keep-alive cache)
- **Scribble** — pen + eraser; strokes move with content

### Selection, move & transform

- **Multi-select** — marquee (rotation-aware hit), Shift/Ctrl additive; joint **move** for free items + stack folders
- **Group bbox** — proportional scale from corners/edges; edge snap while scaling; box does not steal crop/pan gestures
- **Snap / align / pack** — edge snap toggle; toolbar align (rotation-aware AABB); **Ctrl+Arrow** packs selection (closes gaps)
- **Resize handles** — notes, links, free text, media (when selected and free)
- **Modal transforms (Blender-style)** — **G** grab / **R** rotate / **S** scale  
  - LMB confirm · RMB / Esc cancel  
  - **R + Shift** → **15°** angle snap (no guide lines)  
  - G uses edge snap when snap is enabled  
  - R/S apply to media, free text, scribble; G also moves stacks / notes / links / embeds
- **Alt+drag** — duplicate free items or whole stack trees while moving
- **Alt+R** — reset rotation to 0° (center fixed)
- **Alt+S** — restore media display size to natural pixels for the current crop (center fixed)

### Crop (media only)

- Hold **C** + drag a marquee (PureRef-style); cursor becomes crosshair; items do not steal the drag
- **Axis-aligned only** — if rotation ≠ 0, crop is blocked with a short toast: *Can't crop while rotated — Alt+R first*
- **Multi-select** — one marquee can crop **all selected free image/gif/video** that are not rotated; rotated targets are skipped
- Stacks / notes / embeds are never crop targets
- **Alt+C** — restore crop (uncrop): expands back to the full source at the current display scale, **keeps world pose of the visible content and rotation** (correct under CSS center-origin rotate)
- Crop is a normalized source rectangle (`crop`), not pixel baking

### Nested stacks

Stacks are **enterable nested canvases**, not only a visual pile on the same board.

| Action | Behavior |
|--------|----------|
| **Ctrl+G** | Fan-stack free selection, then nest into a `StackRecord` on the current canvas |
| **Double-click folder / pile** | Enter stack (folder expands → free layout inside) |
| **Double-click name tab** | Rename stack (not enter) |
| **Breadcrumb** | Click a segment to go up (multi-level: one animated exit, then silent fold) |
| **Escape** | Leave text/stack-name edit first; then exit to parent container |
| **Space** (one stack selected) | Enter that stack |
| **Alt+G** | Unstack / smooth layout of free selection |
| Drag free items onto a stack | Merge into that stack (drop target highlight) |

#### Data model

| Field | Role |
|-------|------|
| **`StackRecord`** | Folder chrome on the parent (`x/y/w/h`, `name`, `zIndex`, optional saved `viewport`) |
| **`StackRecord.freeFanRel`** | Cached collapsed fan of **all leaves** under this stack (incl. nested), relative to folder origin; written on exit gather |
| **`item.containerId`** | Which canvas the item lives on (`root` or a stack id) |
| **`item.x/y/rotation`** | Free pose **inside** that container |
| **`item.stackPreview`** | Fan pose on the **parent** canvas (parent draws non-interactive previews) |
| **`stacked` / `stackGroupId`** | Mid–Ctrl+G fan animation or legacy boards; cleared after nest |

Nested stack **B inside A**:

- On **home**, A’s pile shows free members of A + B’s leaves as one gather unit
- **Inside A**, B is an atomic folder; B’s fan sits under that folder
- Exit freezes surface **z-order** so units stay ordered as at exit
- Raising/selecting A raises the **whole tree** contiguously
- Stack surface previews are not selectable; only the folder is
- Paste / Alt-drag / copy respect nested trees and unique stack names

Core helpers: `src/utils/stacks.ts`, `src/utils/zOrder.ts`, enter/exit in `src/store/useCanvasStore.ts`, path UI in `src/components/CanvasPath.tsx`.

#### Current limitation

- **Ctrl+G** only nests **free items** on the current canvas. Selected **stack folders** are not included as atomic bodies in one gesture.

### Board I/O & clipboard

- **Ctrl+S** / **Ctrl+Shift+S** — save / save as (toast on success)
- **Ctrl+Shift+O** — open `.icanvas` or legacy JSON
- **Ctrl+O** — open media files
- **Open with** — file association for `.icanvas`; launch path via `get_launch_file_path`
- **Clipboard** — OS paste (links, images, video, paths, text → note); in-app **Ctrl+X/C/V** for free items + nested stack trees
- In-app copy buffer is cleared when the window **blurs** (so an external OS copy can take priority on paste)
- Drag-and-drop import of media, URLs, and text

## Board file (`.icanvas`)

Portable JSON document (`magic: ICNV`, `format: InfiniteCanvas`, `formatVersion: 3`):

- Embeds media (and link thumbs when possible) as base64 under `assets`
- Runtime uses `icanvas-asset://…` refs expanded to `data:` URLs on load
- Legacy plain `BoardSnapshot` JSON (`version: 1`) still opens for migration
- Save path re-reads the file and checks **item count** before reporting success

Media paths that fail to pack keep the original `src` rather than dropping the item.

## Stack (runtime)

| Layer | Tech |
|--------|------|
| Shell | Tauri 2 (WebView2 on Windows) |
| UI | React 19 + TypeScript + Vite 7 |
| State | Zustand (`useCanvasStore`) |
| Plugins | dialog, fs, opener |

Desktop APIs (file dialogs, path→URL, window controls, external open) go through `src/utils/desktop.ts` so the UI stays free of Electron APIs.

Native Rust commands include: `fetch_link_preview` (and related image proxy helpers), `get_launch_file_path`, `force_exit_app`.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- Windows 10/11 with WebView2 (usually preinstalled)

## Develop

```bash
cd InfiniteCanvas2
npm install
npm run tauri dev
```

Frontend alone (browser — **no** native save/open dialogs, window chrome, or Rust link previews):

```bash
npm run dev
```

## Build / release

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (NSIS / MSI). The main executable is typically tens of MB — far smaller than the Electron ~150–200 MB build.

## Project layout

```
InfiniteCanvas2/
  src/
    App.tsx                 # Shell: keyboard, menus, close guard, launch-file open
    components/
      InfiniteCanvas.tsx    # Pointer tools, crop, marquee, G/R/S, group scale
      CanvasPath.tsx        # Breadcrumb
      StackFolder.tsx       # Nested folder chrome
      CloseSaveDialog.tsx   # Save / Discard / Cancel on exit
      Toolbar.tsx · WindowChrome.tsx · EmptyState.tsx · SaveToast.tsx
      items/                # Media, text, note, link, scribble, embed views
      style/                # Style inspector for selection
    hooks/
      useKeyboard.ts        # Global shortcuts
      useCloseGuard.ts      # Unsaved close prompt
      useHistoryOnce.ts     # One history push per gesture
      useDesktopMenu.ts · useWindowDrag.ts
    store/
      useCanvasStore.ts     # Zustand surface (canvas, stacks, layout, I/O)
      types.ts              # HistoryEntry, StackEnterAnim, ItemPatchOptions
      itemPatch.ts          # Pure item-list patch helpers
      cloneDocument.ts      # Deep clone for clipboard / Alt-drag stacks
    types/canvas.ts         # CanvasItem, StackRecord, BoardSnapshot, CropRect
    utils/
      stacks.ts · zOrder.ts · layout.ts
      geometry.ts           # Rotation-aware AABB, hit tests (center-origin CSS)
      crop.ts               # Axis-aligned crop + rotation-aware uncrop
      modalTransform.ts     # G / R / S session math (Shift 15° on R)
      selectionBounds.ts    # Multi-select group bbox + scale
      snap.ts · align.ts
      boardFile.ts · boardIO.ts
      dropImport.ts · media.ts · openMedia.ts
      embed*.ts · linkMeta.ts · desktop.ts
  src-tauri/                # Rust host, link preview SSRF checks, Tauri config
  docs/                     # local-only (gitignored)
```

## Keyboard (summary)

| Shortcut | Action |
|----------|--------|
| **Ctrl+O** | Open media files |
| **Ctrl+Shift+O** | Open project (`.icanvas` / JSON) |
| **Ctrl+S** | Save board |
| **Ctrl+Shift+S** | Save as |
| **Ctrl+V** | Paste OS clipboard or in-app clipboard |
| **Ctrl+C / Ctrl+X** | Copy / cut selection (items + nested stack trees) |
| **Ctrl+G** | Stack free selection (nest into enterable stack) |
| **Alt+G** | Unstack / smooth layout |
| **Ctrl+F** | Toggle immersive mode |
| **F** or **Ctrl+0** | Fit all content |
| **Ctrl+Arrow** | Pack selection toward that side |
| **C** + drag | Crop free media (axis-aligned; multi-select supported) |
| **Alt+C** | Restore crop (uncrop; keeps pose + rotation) |
| **Alt+R** | Reset rotation to 0° |
| **Alt+S** | Restore media to natural pixel size |
| **G / R / S** | Modal move / rotate / scale (LMB confirm · RMB cancel) |
| **R + Shift** | While rotating: snap angle to 15° |
| **Space** | Enter selected stack · play/pause selected video · else hold to pan |
| **Escape** | Exit text/rename edit → leave nested stack → clear selection |
| **Delete / Backspace** | Remove selection |
| **Alt + drag** | Duplicate items or stack trees |
| **Ctrl+Z / Ctrl+Y** | Undo / redo |
| **[ / ]** | Send to back / bring to front |
| **V H P/B E T N L** | Tools: select, pan, pen, erase, text, note, link |
| **Double-click link** | Open URL externally |
| **Ctrl+Q** | Quit (Save / Discard / Cancel when dirty) |
| **Ctrl+R / F5** | Blocked (prevents wiping the canvas) |

## Security notes (desktop)

Current packaging is convenient for a personal media tool; review before wider distribution:

| Setting | Current | Risk |
|---------|---------|------|
| FS scope | User folders (`$HOME` and common paths) | Media on other volumes may need copy or wider scope |
| CSP | `null` | No Content-Security-Policy on the WebView |
| Asset protocol | Broad local asset loading | Local file exposure depends on protocol config |
| Embed sandbox | scripts + same-origin + popups | Arbitrary pasted embeds are relatively powerful |
| Link preview | Public-IP / host checks, redirect re-validation, size caps | Residual DNS rebinding TOCTOU |

## Known issues / residual risks

1. **FS scope** is limited to home and common user folders — media on other volumes may fail until copied or scope is expanded  
2. Embed iframes still need `allow-scripts` + `allow-same-origin` for many players (sandbox is tighter but not zero-trust)  
3. **Ctrl+G** does not yet nest selected stack folders as atomic bodies in one gesture  
4. Product backlog (local): multi-scale boards, audio items, richer rotation UI  

## License

Private / local project unless otherwise noted.
