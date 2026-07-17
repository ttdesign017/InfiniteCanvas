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

7. Viewport culling: free items / folders / fan previews filtered by expanded world frustum (`viewportCull` + `useWorldCullRect`); selected bodies always kept; disabled during stack anim.
8. Incremental pack cache: session `packAssetCache` keyed by runtime `src` (+ fileName); second save reuses base64.
11. Video lazy load: `IntersectionObserver` attaches `<video src>` when near viewport; detaches when far (unless selected/playing).

## Notes

- First open after cold start includes WebView media decode — report both “interactive” and “all thumbs decoded” if they diverge.
- 4K full-res embeds are out of B-tier scope; note if sample uses them.
