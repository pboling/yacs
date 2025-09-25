/*
  updates.bus.ts
  Tiny pub/sub to broadcast per-key update events originating from WS messages.
  Components can subscribe and optionally filter by a specific key (pair|token|chain).
*/

export interface UpdateEvent { key: string; type: 'tick' | 'pair-stats'; data?: unknown }

const listeners = new Set<(e: UpdateEvent) => void>()

export function emitUpdate(e: UpdateEvent) {
  for (const cb of Array.from(listeners)) {
    try { cb(e) } catch { /* ignore */ }
  }
}

export function onUpdate(cb: (e: UpdateEvent) => void): () => void {
  listeners.add(cb)
  return () => { try { listeners.delete(cb) } catch { /* no-op */ }
}
}
