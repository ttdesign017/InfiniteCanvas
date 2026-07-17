import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installGlobalDiagHandlers, diagInfo } from './utils/diagLog'

installGlobalDiagHandlers()
diagInfo('boot', 'IC2 frontend mounting')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="AppRoot">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
