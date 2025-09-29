/*
  updates.bus.ts
  Tiny pub/sub to broadcast per-key update events originating from WS messages.
  Components can subscribe and optionally filter by a specific key (pair|token|chain).
*/

export interface UpdateEvent {
  key: string
  type: 'tick' | 'pair-stats'
  data?: unknown
}

const listeners = new Set<(e: UpdateEvent) => void>()
// New: keyed listeners to avoid O(N) fan-out on every event
const keyed = new Map<string, Set<(e: UpdateEvent) => void>>()

export function emitUpdate(e: UpdateEvent) {
  // Notify key-specific listeners first
  try {
    const set = keyed.get(e.key)
    if (set && set.size > 0) {
      for (const cb of Array.from(set)) {
        try {
          cb(e)
        } catch {
          /* ignore */
        }
      }
    }
  } catch {}
  // Notify generic listeners
  for (const cb of Array.from(listeners)) {
    try {
      cb(e)
    } catch {
      /* ignore */
    }
  }
}

export function onUpdate(cb: (e: UpdateEvent) => void): () => void {
  listeners.add(cb)
  return () => {
    try {
      listeners.delete(cb)
    } catch {
      /* no-op */
    }
  }
}

export function onUpdateKey(key: string, cb: (e: UpdateEvent) => void): () => void {
  const k = String(key)
  let set = keyed.get(k)
  if (!set) {
    set = new Set()
    keyed.set(k, set)
  }
  set.add(cb)
  return () => {
    try {
      const s = keyed.get(k)
      if (s) {
        s.delete(cb)
        if (s.size === 0) keyed.delete(k)
      }
    } catch {
      /* no-op */
    }
  }
}
