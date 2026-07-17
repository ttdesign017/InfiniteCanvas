# Diagnostics (crash / stack enter)

## What was added

| Piece | Role |
|-------|------|
| `src/utils/diagLog.ts` | Ring buffer + console + optional file log |
| `ErrorBoundary` | Catches **React render** errors; keeps window open |
| Global `error` / `unhandledrejection` | Catches free-floating JS errors |
| `enterStack` try/catch + breadcrumbs | Logs begin / RAF / failures |
| Canvas-scoped boundary | Isolates canvas crash from chrome |

## Where logs go

1. **DevTools console** (`console.error` / `info`)  
2. **localStorage** key `ic2_diag_log` (last ~40 entries)  
3. **Desktop file** (best-effort):  
   `%LOCALAPPDATA%\InfiniteCanvas\logs\diag.log`

## How to use after a crash

### A. UI still open (Error Boundary)

- Red/white panel: **Copy error + diag log** → paste here  
- Or **Reload** / **Try continue**

### B. Full window quit (native / OOM)

1. Reopen app or open:  
   `C:\Users\Admin\AppData\Local\InfiniteCanvas\logs\diag.log`  
2. Look for last lines:  
   - `enterStack: begin` without `RAF scheduled` → failed during setup  
   - `enterStack: RAF scheduled` then silence → likely **WebView kill / OOM** mid-animation (not a JS throw)  
   - `enterStack failed` / `enter RAF tick failed` → JS exception with stack  

### C. From browser console (if WebView allows)

```js
JSON.parse(localStorage.getItem('ic2_diag_log') || '[]')
```

## Limits

| Captures | Does **not** capture |
|----------|----------------------|
| React render errors | Process killed by OOM / Task Manager |
| `enterStack` throws | Native WebView2 abort without JS |
| Unhandled promise rejections | Dev process killed by external timeout |

If the last log is `enterStack: RAF scheduled` and the app dies with **no** `enterStack failed`, treat as **native/OOM**, not a missing try/catch.
