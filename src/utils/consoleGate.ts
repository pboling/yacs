import { isDebugEnabled } from './debug'

let installed = false

export function installConsoleGate() {
  if (installed) return
  installed = true
  if (typeof window === 'undefined') return
  try {
    const origLog = console.log.bind(console)
    const origDebug = console.debug ? console.debug.bind(console) : origLog

    const gated = (...args: unknown[]) => {
      if (isDebugEnabled()) {
        origLog(...args)
      }
    }
    const gatedDebug = (...args: unknown[]) => {
      if (isDebugEnabled()) {
        origDebug(...args)
      }
    }

    // Gate verbose logs; leave error/warn/info intact

    console.log = gated as typeof console.log

    console.debug = gatedDebug as typeof console.debug
  } catch {
    // no-op
  }
}
