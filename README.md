# Infinite Canvas 2 (Tauri)

PureRef-inspired infinite canvas for Windows — **Tauri 2 + React + TypeScript** rewrite of [InfiniteCanvas](../InfiniteCanvas) (Electron). Same UI and workflow, much smaller binary.

## Features

- **Infinite canvas** — pan (middle mouse / Space+drag), zoom (wheel / Ctrl+/-), fit all content (Ctrl+0)
- **Media** — images, GIF, video (custom player: play triangle + hover progress scrubber)
- **Notes & links** — Notion-style cards; free-floating text with color / font / size / background
- **Scribble** — pen + eraser; strokes move with content
- **Crop** — hold **C** and drag (PureRef-style); works from outside the image
- **Stack / Layout** — **Ctrl+G** stack (slight rotation, folder chrome, moves as a group); **Alt+G** tight shelf layout
- **Snap** — toggle edge/alignment snap on the right toolbar
- **Alt-drag** — duplicate any canvas item
- **Clipboard** — paste links, images, videos (Ctrl+V); open files with Ctrl+O
- **Board I/O** — Ctrl+S save / Ctrl+Shift+O load JSON board
- **Frameless window** — minimal chrome (hover top-right); right-drag moves the window; **Ctrl+Q** quits

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
  src/                 # React app (ported from InfiniteCanvas)
    components/        # Canvas, toolbars, chrome, item views
    hooks/             # keyboard, window drag, desktop menus
    store/             # Zustand canvas store
    utils/             # media, layout, snap, desktop shell API
  src-tauri/           # Rust host + Tauri config
```

Desktop APIs (file dialogs, path→URL, window controls) go through `src/utils/desktop.ts` so the UI stays free of Electron APIs.

## Keyboard (summary)

| Shortcut | Action |
|----------|--------|
| Ctrl+O | Open media |
| Ctrl+V | Paste link / image / video |
| Ctrl+S | Save board |
| Ctrl+Shift+O | Load board |
| Ctrl+G | Stack selection |
| Alt+G | Unstack / tight layout |
| C + drag | Crop selected image |
| Space | Play/pause selected video (or pan) |
| Delete | Remove selection |
| Alt + drag | Duplicate |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+0 | Fit content / reset view |
| Ctrl+Q | Quit |

## License

Private / local project unless otherwise noted.
