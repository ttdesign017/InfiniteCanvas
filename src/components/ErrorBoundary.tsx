import { Component, type ErrorInfo, type ReactNode } from 'react'
import { diagError, getDiagText } from '../utils/diagLog'

type Props = {
  children: ReactNode
  /** Label for logs, e.g. "App" / "Canvas" */
  name?: string
}

type State = {
  error: Error | null
  info: string | null
}

/**
 * Catches React render errors so the window does not go fully blank.
 * Does not catch native WebView OOM / process kills.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const name = this.props.name || 'ErrorBoundary'
    diagError(name, error.message, {
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    })
    this.setState({ info: errorInfo.componentStack || null })
  }

  private copyLogs = () => {
    const text = [
      this.state.error
        ? `${this.state.error.name}: ${this.state.error.message}\n${this.state.error.stack || ''}`
        : '',
      this.state.info || '',
      '--- diag log ---',
      getDiagText(),
    ]
      .filter(Boolean)
      .join('\n\n')
    void navigator.clipboard?.writeText(text).catch(() => {
      /* ignore */
    })
  }

  private reload = () => {
    window.location.reload()
  }

  private dismiss = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="diag-error-boundary" role="alert">
        <div className="diag-error-card">
          <h1>Something broke in the UI</h1>
          <p className="diag-error-lead">
            A React error was caught (the window stayed open). Native WebView
            crashes / OOM will not show this screen — check{' '}
            <code>%LOCALAPPDATA%\InfiniteCanvas\logs\diag.log</code> if the app
            fully quit.
          </p>
          <pre className="diag-error-stack">
            {error.name}: {error.message}
            {'\n'}
            {error.stack}
            {info ? `\n\nComponent stack:${info}` : ''}
          </pre>
          <div className="diag-error-actions">
            <button type="button" className="diag-btn primary" onClick={this.copyLogs}>
              Copy error + diag log
            </button>
            <button type="button" className="diag-btn" onClick={this.reload}>
              Reload app
            </button>
            <button type="button" className="diag-btn" onClick={this.dismiss}>
              Try continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}
