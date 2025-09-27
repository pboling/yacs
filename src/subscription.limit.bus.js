// subscription.limit.bus.js
// Global bus for dynamic subscription defaults (ESM singleton stashed on globalThis)
// Allows configuring the default inactive subscription base limit used when no throttle is set.
// API:
//  - getDefaultInactiveBaseLimit(): number
//  - setDefaultInactiveBaseLimit(n: number): void
//  - onDefaultInactiveBaseLimitChange(cb: (n:number)=>void): () => void

function getStore() {
  const g = /** @type {any} */ (globalThis)
  if (!g.__SUB_LIMIT__) {
    g.__SUB_LIMIT__ = {
      base: 100, // default legacy behavior
      listeners: new Set(),
    }
  }
  return /** @type {{base:number;listeners:Set<(n:number)=>void>}} */ (g.__SUB_LIMIT__)
}

export function getDefaultInactiveBaseLimit() {
  return getStore().base
}

export function setDefaultInactiveBaseLimit(n) {
  const store = getStore()
  const safe = Math.max(0, Math.floor(Number.isFinite(n) ? Number(n) : 0))
  if (safe === store.base) return
  store.base = safe
  for (const l of Array.from(store.listeners)) {
    try {
      l(safe)
    } catch {
      /* no-op */
    }
  }
}

export function onDefaultInactiveBaseLimitChange(cb) {
  const store = getStore()
  store.listeners.add(cb)
  return () => {
    try {
      store.listeners.delete(cb)
    } catch {
      /* no-op */
    }
  }
}
