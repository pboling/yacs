// ws.console.bus.ts
// Lightweight pub/sub bus with in-memory history for WebSocket console messages
// Keeps history until explicitly cleared; consumers can subscribe to changes.

export type WsConsoleLevel = 'info' | 'success' | 'error'
export interface WsConsoleEntry {
  id: number
  ts: number
  level: WsConsoleLevel
  text: string
}

type Listener = (entries: WsConsoleEntry[]) => void

const history: WsConsoleEntry[] = []
const listeners = new Set<Listener>()
let __seq = 0

function emit() {
  const snapshot = history.slice()
  for (const fn of listeners) {
    try {
      fn(snapshot)
    } catch {}
  }
}

export function onWsConsoleChange(fn: Listener) {
  listeners.add(fn)
  // Immediately emit current snapshot to new subscribers
  try {
    fn(history.slice())
  } catch {}
  return () => listeners.delete(fn)
}

export function getWsConsoleHistory(): WsConsoleEntry[] {
  return history.slice()
}

export function clearWsConsole() {
  history.length = 0
  emit()
}

function push(level: WsConsoleLevel, text: string) {
  history.push({ id: ++__seq, ts: Date.now(), level, text })
  // Cap history generously; WsConsole applies a 100-message cap AFTER filtering.
  // This prevents filtered-out noise from evicting useful entries.
  const MAX = 2000
  if (history.length > MAX) history.splice(0, history.length - MAX)
  emit()
}

export function logWsInfo(text: string) {
  push('info', text)
}
export function logWsSuccess(text: string) {
  push('success', text)
}
export function logWsError(text: string) {
  push('error', text)
}
