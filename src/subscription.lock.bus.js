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

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

function getStore() {
  const g = /** @type {any} */ (globalThis)
  if (!g.__SUB_LOCK__) {
    g.__SUB_LOCK__ = {
      state: { active: false, allowed: new Set() },
      listeners: new Set(),
    }
  }
  return /** @type {{state:{active:boolean;allowed:Set<string>};listeners:Set<Function>}} */ (g.__SUB_LOCK__)
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
  if (!prevActive || next.size > 0) {
    for (const l of store.listeners) {
      try { l(store.state) } catch { /* no-op */ }
    }
  }
}

export function releaseSubscriptionLock() {
  const store = getStore()
  if (!store.state.active) return
  store.state.active = false
  store.state.allowed = new Set()
  for (const l of store.listeners) {
    try { l(store.state) } catch { /* no-op */ }
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
  return () => { store.listeners.delete(cb) }
}

