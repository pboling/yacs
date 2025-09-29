/*
  main.tsx
  Application entry point: sets up React root, installs console gate, and renders App.
*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/blurOnMouseClick'
import App from './App.tsx'
import { installConsoleGate } from './utils/consoleGate'

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found')
}
installConsoleGate()

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
