// visibility.bus.js
// A tiny shared registry to coordinate fast-viewport visibility for pair subscriptions
// across multiple panes. Keys are the composite 'pair|token|chain'.
//
// Behavior:
// - markVisible(key): increments the viewer count for a key and returns { prev, next }.
// - markHidden(key): decrements (not below 0) and returns { prev, next }.
// - getCount(key): current count (number of panes that currently view this key in viewport).
// - resetAll(): clears the registry (used in tests).
//
// Implementation detail:
// We prefer a window-backed Map to survive module re-evaluation during HMR/dev and to be
// shared naturally across module instances, but we fall back to a module-local Map when
// window is not available (e.g., in Node tests).

/** @type {Map<string, number>} */
const localStore = new Map()

function getStore() {
  try {
    const anyWin = /** @type {any} */ (globalThis)
    if (anyWin && typeof anyWin === 'object') {
      if (!anyWin.__PAIR_VIS_COUNTS__) {
        anyWin.__PAIR_VIS_COUNTS__ = new Map()
      }
      return /** @type {Map<string, number>} */ (anyWin.__PAIR_VIS_COUNTS__)
    }
  } catch {
    // ignore and fall back
  }
  return localStore
}

/**
 * @param {string} key
 * @returns {{ prev: number, next: number }}
 */
export function markVisible(key) {
  const store = getStore()
  const prev = Number(store.get(key) || 0)
  const next = prev + 1
  store.set(key, next)
  return { prev, next }
}

/**
 * @param {string} key
 * @returns {{ prev: number, next: number }}
 */
export function markHidden(key) {
  const store = getStore()
  const prev = Number(store.get(key) || 0)
  const next = prev > 0 ? prev - 1 : 0
  if (next === 0) store.delete(key)
  else store.set(key, next)
  return { prev, next }
}

/**
 * @param {string} key
 * @returns {number}
 */
export function getCount(key) {
  const store = getStore()
  return Number(store.get(key) || 0)
}

export function resetAll() {
  const store = getStore()
  store.clear()
}
