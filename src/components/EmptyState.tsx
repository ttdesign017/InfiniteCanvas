export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Drop references.</h1>
        <p>
          Images, GIFs, video, scribbles, free text, notes, and links —
          stack, layout, crop, and paste URLs with Ctrl+V.
        </p>
        <ul>
          <li>
            <kbd>Drop</kbd> media · <kbd>C</kbd> crop · <kbd>Ctrl+Shift+C</kbd> restore
          </li>
          <li>
            <kbd>P</kbd> draw · <kbd>E</kbd> erase · <kbd>T</kbd> text · <kbd>N</kbd> note
          </li>
          <li>
            <kbd>Ctrl+S</kbd> save · <kbd>Ctrl+Shift+O</kbd> open project · <kbd>Ctrl+V</kbd> paste · <kbd>Space</kbd> play
          </li>
          <li>
            <kbd>Ctrl+G</kbd> stack · <kbd>Alt+G</kbd> unstack / layout
          </li>
        </ul>
      </div>
    </div>
  )
}
