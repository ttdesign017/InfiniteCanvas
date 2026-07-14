# Infinite Canvas 2 (Tauri)

PureRef-inspired infinite canvas for Windows — **Tauri 2 + React + TypeScript** rewrite of [InfiniteCanvas](../InfiniteCanvas) (Electron). Same UI and workflow, much smaller binary.

## Features

- **Infinite canvas** — pan (middle mouse / Space+drag), zoom (wheel / Ctrl+/-), fit all content (Ctrl+0)
- **Media** — images, GIF, video (custom player: play triangle + hover progress scrubber)
- **Notes & links** — Notion-style cards; free-floating text with color / font / size / background
- **Embeds** — iframe apps (e.g. podcasts) stay mounted across stack navigation (keep-alive poses)
- **Scribble** — pen + eraser; strokes move with content
- **Crop** — hold **C** and drag (PureRef-style); works from outside the image
- **Nested stacks** — enterable folders that are full nested canvases (see below)
- **Snap** — toggle edge/alignment snap on the right toolbar
- **Alt-drag** — duplicate any canvas item
- **Clipboard** — paste links, images, videos (Ctrl+V); open files with Ctrl+O
- **Board I/O** — Ctrl+S save / Ctrl+Shift+O load `.icanvas` / JSON board
- **Frameless window** — minimal chrome (hover top-right); right-drag moves the window; **Ctrl+Q** quits
- **Immersive mode** — **Ctrl+F** hides side toolbars (fade); corner toggle; top bar still shows when items are selected

## Nested stacks

Stacks are **enterable nested canvases**, not just a visual pile on the same board.

| Action | Behavior |
|--------|----------|
| **Ctrl+G** | Fan-stack selection, then nest into a `StackRecord` on the current canvas |
| **Double-click folder / pile** | Enter stack (folder expands → free layout inside) |
| **Double-click name tab** | Rename stack (not enter) |
| **Breadcrumb (top-left)** | `Home / … / current`; click a segment to go up; path updates as soon as exit starts |
| **Exit (breadcrumb / Back)** | Reverse morph: free layout → fan; outer frame size includes **all leaves** (direct + nested) with pad |

### Data model

- **`StackRecord`** — folder chrome on the parent (`x/y/w/h`, `name`, `zIndex`, optional saved `viewport`)
- **`item.containerId`** — which canvas the item lives on (`root` or a stack id)
- **`item.x/y/rotation`** — free pose **inside** that container
- **`item.stackPreview`** — fan pose on the **parent** canvas (parent draws non-interactive previews)
- **`stacked` / `stackGroupId`** — only for mid–Ctrl+G fan animation or legacy boards; cleared after nest

Nested stack **B inside A**:

- On **home**, A’s pile shows free members of A + B’s leaves as one gather unit
- **Inside A**, B is an atomic folder at its free pose; B’s fan sits under that folder
- Exit A freezes surface **z-order** (B as a unit stays above/below free siblings as at exit)
- Raising/selecting A raises the **whole tree** (folder + nested stacks + leaves) contiguously
- Stack surface previews are not selectable/movable; only the folder is

Core helpers: `src/utils/stacks.ts`, `src/utils/zOrder.ts`, enter/exit in `src/store/useCanvasStore.ts`, path UI in `src/components/CanvasPath.tsx`.

## Stack

| Layer | Tech |
|--------|------|
| Shell | Tauri 2 (WebView2 on Windows) |
| UI | React 19 + TypeScript + Vite 7 |
| State | Zustand |
| Plugins | dialog, fs, opener |

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

Frontend alone (browser, no native dialogs/window chrome):

```bash
npm run dev
```

## Build / release

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (NSIS / MSI). The main executable is typically tens of MB — far smaller than the Electron ~150–200 MB build — because the system WebView is used instead of bundling Chromium.

## Project layout

```
InfiniteCanvas2/
  src/
    components/     # Canvas, toolbars, chrome, item views, CanvasPath, StackFolder
    hooks/          # keyboard, window drag, desktop menus
    store/          # Zustand (enter/exit stack, history, board I/O)
    types/          # CanvasItem, StackRecord, board snapshot
    utils/
      stacks.ts     # Nested stack model, fan cards, folder bounds, migration
      zOrder.ts      # Atomic raise of free items + nested stack trees
      layout.ts      # Fan / tight layout, stackGroupBounds
      embed*.ts      # Embed keep-alive pose + iframe cache
      snap.ts / align.ts  # Leaf-hull aware snap/align for nested stacks
  src-tauri/        # Rust host + Tauri config
  feature requests.md
```

Desktop APIs (file dialogs, path→URL, window controls) go through `src/utils/desktop.ts` so the UI stays free of Electron APIs.

## Keyboard (summary)

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open media |
| Ctrl+V | Paste link / image / video |
| Ctrl+S | Save board |
| Ctrl+Shift+O | Load board |
| Ctrl+G | Stack selection (nest into enterable stack) |
| Alt+G | Unstack / tight layout |
| Ctrl+F | Toggle immersive mode (hide side toolbars) |
| C + drag | Crop selected image |
| Space | Play/pause selected video (or pan); enter selected stack when applicable |
| Delete | Remove selection |
| Alt + drag | Duplicate |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+0 | Fit content / reset view |
| Ctrl+Q | Quit |

## License

Private / local project unless otherwise noted.
