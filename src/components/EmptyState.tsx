export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Drop references.</h1>
        <p>
          Images, GIFs, video, scribbles, free text, notes, and links —
          stack, layout, crop. Drag URLs, media, or text from the browser.
        </p>
        <ul>
          <li>
            <kbd>Drop</kbd> media · <kbd>C</kbd> crop · <kbd>Alt+R</kbd> unrotate · <kbd>Alt+C</kbd> uncrop
          </li>
          <li>
            <kbd>P</kbd> draw · <kbd>E</kbd> erase · <kbd>T</kbd> text · <kbd>N</kbd> note
          </li>
          <li>
            <kbd>Ctrl+S</kbd> save · <kbd>Ctrl+X</kbd>/<kbd>C</kbd>/<kbd>V</kbd> cut/copy/paste · <kbd>Space</kbd> play
          </li>
          <li>
            <kbd>Ctrl+G</kbd> stack · <kbd>Alt+G</kbd> unstack / layout
          </li>
        </ul>
      </div>
    </div>
  )
}
