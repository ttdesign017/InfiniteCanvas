# Performance baseline (P0/P1)

Record machine + version numbers after meaningful I/O or render changes.  
Enable console timings with `localStorage.setItem('ic2_perf', '1')` then save/open a board (dev also logs by default).

## How to measure

| Metric | How |
|--------|-----|
| Save total | Console: `[ic2 perf] save-total: Xms` (also `save-pack`) |
| Open total | Console: `[ic2 perf] open-total: Xms` (also `open-read`) |
| Pan/zoom | Edge/WebView Performance panel — FPS while panning a 50–100 item board |
| Memory | Task Manager RSS after open + 5 min idle / undo spam |

## Template (fill after a local run)

| Field | Value |
|-------|--------|
| Date | |
| App version | 1.1.0+ (post P0/P1 I/O + anim) |
| Machine | e.g. Win11, CPU, RAM |
| Sample board | e.g. 80 thumbs + 20 notes + 3-level stacks |

| Scenario | Target (B-tier) | Measured |
|----------|-----------------|----------|
| Open typical board → interactive | ≤ 5 s | |
| Save (media already in memory) | ≤ 3 s or progress UI | |
| Idle pan/zoom ~100 items | ≥ ~50 FPS visual | |
| Undo ×10 | no multi-second freeze | |

## Changes covered by this baseline generation

**P0**

1. Open: `icanvas-asset://` + `packedAssets` → base64→Blob (no intermediate `data:` peak); hydrate after revoke.
2. Save: in-memory schema verify once; disk only checks UTF-8 byte length (no double full re-read/parse).
3. Pack: media loads with concurrency 6 (`mapPool`).

**P1**

4. Stack morph progress on `stackAnimProgress` bus (not per-frame Zustand `stackEnterAnim` rewrites for enter / exit settle).
5. Viewport transform isolated in `CanvasWorldTransform` (controller no longer subscribes to viewport).
6. `perfMarks` on save/open paths.

**P2 (7 / 8 / 11)**

7. ~~Viewport culling unmount~~ **Revised (P0 perf fix):** paint-cull unmount was **reverted**. Filtering free items out of the React tree on every pan/zoom remounted media (blank flash / long missing items) and re-subscribed the controller to `viewport` (undoing `CanvasWorldTransform` isolation). Current container free items stay mounted; `useWorldCullRect` remains for optional future throttled policies only.
8. Incremental pack cache: session `packAssetCache` keyed by runtime `src` (+ fileName); second save reuses base64.
11. Video lazy load: `IntersectionObserver` + poster-sticky stills — live `<video>` only when playing/selected or still capturing a poster; idle cards prefer cached still (no decoder thrash on pan).

**P0 multi-item follow-up (50+ elements)**

12. Stack nav: `useStackNavGhosts` no longer subscribes to per-frame `stackAnimProgress` (opacity applied in paint layer only).
13. Fan preview item object identity reused when pose/src unchanged (`useCanvasSurfaceModel`).
14. Dropped global `.canvas-item { will-change: transform }` (too many compositor layers on media boards).
15. Smaller `.canvas-grid` world extent (less paint under scale).

## Notes

- First open after cold start includes WebView media decode — report both “interactive” and “all thumbs decoded” if they diverge.
- 4K full-res embeds are out of B-tier scope; note if sample uses them.
- Regression check: pan/zoom a 50-media board for 10s — no blank flashes, no multi-second missing cards.
