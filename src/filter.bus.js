/*
  filter.bus.js
  Tiny event bus to coordinate filter UI interactions with panes.
  Events:
  - focusStart: emitted when any filter input gains focus → panes should pause most subscriptions
  - applyComplete: emitted after a filter change has been applied and rows/pages update completed → panes may resume subscriptions
*/

/** @type {Set<Function>} */
const focusStartListeners = new Set()
/** @type {Set<Function>} */
const applyCompleteListeners = new Set()

/**
 * Subscribe to the filter focus start event.
 * When any filter input gains focus, panes should pause heavy subscriptions (e.g., WS updates)
 * to reduce contention and avoid janky UI while typing.
 * @param {() => void} cb
 * @returns {() => void} Unsubscribe function.
 */
export function onFilterFocusStart(cb) {
  focusStartListeners.add(cb)
  return () => {
    try {
      focusStartListeners.delete(cb)
    } catch {
      /* no-op */
    }
  }
}
/**
 * Subscribe to the filter apply-complete event.
 * Emitted after a filter change has been applied and rows/pages update completed;
 * panes may resume subscriptions (e.g., WS updates) at this point.
 * @param {() => void} cb
 * @returns {() => void} Unsubscribe function.
 */
export function onFilterApplyComplete(cb) {
  applyCompleteListeners.add(cb)
  return () => {
    try {
      applyCompleteListeners.delete(cb)
    } catch {
      /* no-op */
    }
  }
}

/**
 * Emit the filter focus start event synchronously to all current subscribers.
 * Listeners are executed in registration order; exceptions are caught and ignored.
 */
export function emitFilterFocusStart() {
  for (const cb of Array.from(focusStartListeners)) {
    try {
      cb()
    } catch {
      /* ignore */
    }
  }
}
/**
 * Emit the filter apply-complete event synchronously to all current subscribers.
 * Use after the UI has applied filters and updated rows/pages.
 */
export function emitFilterApplyComplete() {
  for (const cb of Array.from(applyCompleteListeners)) {
    try {
      cb()
    } catch {
      /* ignore */
    }
  }
}
