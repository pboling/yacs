/*
  tick.bus.ts
  Global 1s heartbeat for chart animations so all charts advance in sync.
  Usage:
    import { onTick, now } from './tick.bus'
    useEffect(() => onTick(() => setTick((n)=>n+1)), [])
*/

const tickListeners = new Set<(ts: number) => void>()

let timerId: number | null = null

function emit(ts: number) {
  // Notify function subscribers
  for (const cb of Array.from(tickListeners)) {
    try {
      cb(ts)
    } catch {
      /* ignore */
    }
  }
  // Also broadcast as a DOM CustomEvent for components that prefer event listeners
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('dex:tick', { detail: ts }))
    }
  } catch {
    /* no-op */
  }
}

function start() {
  if (timerId != null) return
  // Align to next second to keep all clients synchronized
  const align = () => {
    const nowTs = Date.now()
    const delay = 1000 - (nowTs % 1000)
    timerId = window.setTimeout(() => {
      // Switch to interval after first aligned timeout
      emit(Date.now())
      timerId = window.setInterval(() => {
        emit(Date.now())
      }, 1000)
    }, delay) as unknown as number
  }
  try {
    align()
  } catch {
    // Fallback: plain 1s interval if alignment fails
    timerId = window.setInterval(() => {
      emit(Date.now())
    }, 1000)
  }
}

export function onTick(cb: (ts: number) => void): () => void {
  if (tickListeners.size === 0) start()
  tickListeners.add(cb)
  // Fire once so subscribers can paint immediately
  try {
    cb(Date.now())
  } catch {
    /* no-op */
  }
  return () => {
    try {
      tickListeners.delete(cb)
      if (tickListeners.size === 0 && timerId != null) {
        try {
          window.clearTimeout(timerId)
        } catch {}
        try {
          window.clearInterval(timerId)
        } catch {}
        timerId = null
      }
    } catch {
      /* no-op */
    }
  }
}

export function now() {
  return Date.now()
}
