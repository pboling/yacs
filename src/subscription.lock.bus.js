// subscription.lock.bus.js
// A lightweight pub/sub bus to coordinate a global subscription lock engaged while
// the detail modal is open. When the lock is active, panes should suspend all
// pair / pair-stats subscriptions except for explicitly allowed keys (the row
// shown in the modal). This prevents runaway WS update rates while a user is
// focused on a single token.
//
// Key shape (consistent with other buses): "pair|token|chain"
//
// API:
//  engageSubscriptionLock(allowedKey?: string | string[]) -> void
//  releaseSubscriptionLock() -> void
//  isSubscriptionLockActive() -> boolean
//  getSubscriptionLockAllowedKeys() -> string[]
//  onSubscriptionLockChange(cb: (state:{active:boolean;allowed:Set<string>})=>void) -> () => void
//
// The bus is resilient to HMR / multiple imports by stashing state on globalThis.

function getStore() {
  const g = /** @type {any} */ (globalThis)
  if (!g.__SUB_LOCK__) {
    g.__SUB_LOCK__ = {
      state: { active: false, allowed: new Set() },
      listeners: new Set(),
      // Added subscription tracking and limits
      subs: {
        fast: new Map(), // key -> timestamp
        slow: new Map(), // key -> timestamp
      },
      panes: {
        visibleCounts: new Map(), // paneId -> visible rows count (viewport only)
        renderedCounts: new Map(), // paneId -> rendered (filtered) rows count
      },
      limits: { normal: 0, fast: 0, slow: 0 },
      lastMetricsHash: '',
      metricsListeners: new Set(),
    }
  }
  return /** @type {{state:{active:boolean;allowed:Set<string>};listeners:Set<Function>;subs:{fast:Map<string,number>;slow:Map<string,number>};panes:{visibleCounts:Map<string,number>;renderedCounts:Map<string,number>};limits:{normal:number;fast:number;slow:number};lastMetricsHash:string;metricsListeners:Set<Function>}} */ (
    g.__SUB_LOCK__
  )
}

export function engageSubscriptionLock(allowedKey) {
  const store = getStore()
  const prevActive = store.state.active
  store.state.active = true
  const next = new Set()
  if (Array.isArray(allowedKey)) {
    for (const k of allowedKey) if (k) next.add(String(k))
  } else if (allowedKey) {
    next.add(String(allowedKey))
  }
  store.state.allowed = next
  // When lock engages, shrink fast limit to exactly number of allowed keys (1 or 2 typically)
  recomputeLimits({ force: true })
  if (!prevActive || next.size > 0) {
    for (const l of store.listeners) {
      try {
        l(store.state)
      } catch {
        /* no-op */
      }
    }
  }
}

export function releaseSubscriptionLock() {
  const store = getStore()
  if (!store.state.active) return
  store.state.active = false
  store.state.allowed = new Set()
  recomputeLimits({ force: true })
  for (const l of store.listeners) {
    try {
      l(store.state)
    } catch {
      /* no-op */
    }
  }
}

export function isSubscriptionLockActive() {
  return getStore().state.active
}

export function getSubscriptionLockAllowedKeys() {
  return Array.from(getStore().state.allowed)
}

export function onSubscriptionLockChange(cb) {
  const store = getStore()
  store.listeners.add(cb)
  return () => {
    store.listeners.delete(cb)
  }
}

// Internal: capture a serializable snapshot of current metrics and keys
function snapshot() {
  const store = getStore()
  return {
    active: store.state.active,
    allowed: Array.from(store.state.allowed),
    limits: { ...store.limits },
    counts: { fast: store.subs.fast.size, slow: store.subs.slow.size },
    fastKeys: Array.from(store.subs.fast.keys()),
    slowKeys: Array.from(store.subs.slow.keys()),
    visiblePaneCounts: Object.fromEntries(store.panes.visibleCounts.entries()),
    renderedPaneCounts: Object.fromEntries(store.panes.renderedCounts.entries()),
  }
}

// Internal: emit metrics change only when snapshot hash changes; update debug global
function notifyMetricsIfChanged() {
  const store = getStore()
  const snap = snapshot()
  let hash
  try {
    hash = JSON.stringify({
      a: snap.active,
      f: snap.fastKeys.length,
      s: snap.slowKeys.length,
      l: snap.limits,
    })
  } catch {
    hash = String(Date.now())
  }
  if (hash === store.lastMetricsHash) return
  store.lastMetricsHash = hash
  for (const l of store.metricsListeners) {
    try {
      l(snap)
    } catch {
      /* no-op */
    }
  }
  try {
    const g = /** @type {any} */ (globalThis)
    if (g.SUB_LOCK_DEBUG && typeof g.SUB_LOCK_DEBUG === 'object') {
      g.SUB_LOCK_DEBUG.latest = snap
    }
  } catch {
    /* no-op */
  }
}

// ===== Subscription Limits & Tracking API =====
// Limits definitions:
//  normal (base fast capacity) = sum(visibleCounts across panes) + 6 (3 above + 3 below viewport)
//  fast (active while lock)   = allowed.size (else equals normal)
//  slow                       = sum(renderedCounts across panes)
// Oldest subscriptions (by first registration timestamp) beyond a limit are evicted.

function recomputeLimits({ force = false } = {}) {
  const store = getStore()
  const sumVisible = Array.from(store.panes.visibleCounts.values()).reduce((a, b) => a + b, 0)
  const sumRendered = Array.from(store.panes.renderedCounts.values()).reduce((a, b) => a + b, 0)
  const normal = Math.max(0, sumVisible + 6)
  const fast = store.state.active ? store.state.allowed.size : normal
  const slow = Math.max(0, sumRendered)
  const changed =
    force ||
    store.limits.normal !== normal ||
    store.limits.fast !== fast ||
    store.limits.slow !== slow
  if (changed) {
    store.limits.normal = normal
    store.limits.fast = fast
    store.limits.slow = slow
    enforceLimits()
  }
  notifyMetricsIfChanged()
}

function enforceLimits() {
  const store = getStore()
  // Fast: evict oldest until size <= fast limit, never evict allowed lock keys if active.
  if (store.subs.fast.size > store.limits.fast) {
    const protectedKeys = store.state.active ? store.state.allowed : new Set()
    const entries = Array.from(store.subs.fast.entries())
    entries.sort((a, b) => a[1] - b[1]) // oldest first
    for (const [key] of entries) {
      if (store.subs.fast.size <= store.limits.fast) break
      if (protectedKeys.has(key)) continue
      // Evict
      store.subs.fast.delete(key)
      pendingEvictions.fast.push(key)
    }
  }
  // Slow: evict oldest until size <= slow limit (rare unless logic bug inflates)
  if (store.subs.slow.size > store.limits.slow) {
    const entries = Array.from(store.subs.slow.entries())
    entries.sort((a, b) => a[1] - b[1])
    for (const [key] of entries) {
      if (store.subs.slow.size <= store.limits.slow) break
      store.subs.slow.delete(key)
      pendingEvictions.slow.push(key)
    }
  }
  flushEvictionCallbacks()
  notifyMetricsIfChanged()
}

// Eviction notification handling (consumers can subscribe to be informed which keys to unsubscribe at WS level)
const evictionListeners = new Set()
const pendingEvictions = { fast: [], slow: [] }

function flushEvictionCallbacks() {
  if (pendingEvictions.fast.length === 0 && pendingEvictions.slow.length === 0) return
  const payload = {
    fast: pendingEvictions.fast.splice(0, pendingEvictions.fast.length),
    slow: pendingEvictions.slow.splice(0, pendingEvictions.slow.length),
  }
  for (const l of evictionListeners) {
    try {
      l(payload)
    } catch {
      /* no-op */
    }
  }
}

export function onSubscriptionEvictions(cb) {
  evictionListeners.add(cb)
  return () => {
    evictionListeners.delete(cb)
  }
}

export function onSubscriptionMetricsChange(cb) {
  const store = getStore()
  store.metricsListeners.add(cb)
  // Fire immediately with current snapshot for convenience
  try {
    cb(snapshot())
  } catch {
    /* no-op */
  }
  return () => {
    store.metricsListeners.delete(cb)
  }
}

export function updatePaneVisibleCount(paneId, visibleCount) {
  const store = getStore()
  store.panes.visibleCounts.set(String(paneId), Math.max(0, Number(visibleCount) || 0))
  recomputeLimits()
}

export function updatePaneRenderedCount(paneId, renderedCount) {
  const store = getStore()
  store.panes.renderedCounts.set(String(paneId), Math.max(0, Number(renderedCount) || 0))
  recomputeLimits()
}

export function registerFastSubscription(key) {
  const store = getStore()
  if (!key) return []
  if (store.subs.fast.has(key)) return [] // already tracked; do not refresh age to keep eviction fairness
  store.subs.fast.set(key, Date.now())
  // If key was in slow, remove (upgrade)
  if (store.subs.slow.has(key)) store.subs.slow.delete(key)
  enforceLimits()
  return [] // explicit immediate evictions are emitted via onSubscriptionEvictions
}

export function deregisterFastSubscription(key) {
  const store = getStore()
  if (store.subs.fast.delete(key)) {
    // No further action; downstream pane code will handle WS unsubscription if needed
  }
}

export function registerSlowSubscription(key) {
  const store = getStore()
  if (!key) return []
  if (store.subs.fast.has(key)) return [] // already fast; do not downgrade implicitly here
  if (store.subs.slow.has(key)) return []
  store.subs.slow.set(key, Date.now())
  enforceLimits()
  return []
}

export function deregisterSlowSubscription(key) {
  const store = getStore()
  if (store.subs.slow.delete(key)) {
    // nothing else
  }
}

export function getCurrentLimits() {
  const store = getStore()
  return { ...store.limits }
}

export function getSubscriptionMetrics() {
  return snapshot()
}

export function __resetForTests() {
  const store = getStore()
  store.state.active = false
  store.state.allowed = new Set()
  store.subs.fast.clear()
  store.subs.slow.clear()
  store.panes.visibleCounts.clear()
  store.panes.renderedCounts.clear()
  store.limits.normal = 0
  store.limits.fast = 0
  store.limits.slow = 0
  store.lastMetricsHash = ''
  notifyMetricsIfChanged()
  recomputeLimits({ force: true })
}

// Attach debug global (idempotent)
try {
  const g = /** @type {any} */ (globalThis)
  if (!g.SUB_LOCK_DEBUG) {
    g.SUB_LOCK_DEBUG = {
      getSnapshot: () => snapshot(),
      recompute: () => recomputeLimits({ force: true }),
      subscribe: (fn) => onSubscriptionMetricsChange(fn),
      latest: snapshot(),
    }
  }
} catch {
  /* no-op */
}

// Initial compute in case panes update counts later
recomputeLimits({ force: true })
