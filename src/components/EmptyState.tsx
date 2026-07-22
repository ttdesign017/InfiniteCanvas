const HOTKEYS = [
  { key: 'Drop', label: 'media' },
  { key: 'T', label: 'text' },
  { key: 'N', label: 'note' },
  { key: 'P', label: 'draw' },
  { key: 'C', label: 'crop' },
  { key: 'Space', label: 'play' },
  { key: 'Ctrl+S', label: 'save' },
  { key: 'Ctrl+V', label: 'paste' },
  { key: 'Ctrl+G', label: 'stack' },
] as const

export function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Drop references.</h1>
        <p>Drop anything in. Let ideas take shape as you arrange.</p>
        <ul className="empty-hotkeys">
          {HOTKEYS.map(({ key, label }) => (
            <li key={key}>
              <span className="empty-key">{key}</span>
              <span className="empty-label">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
