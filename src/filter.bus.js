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

export function onFilterFocusStart(cb) {
    focusStartListeners.add(cb)
    return () => { try { focusStartListeners.delete(cb) } catch { /* no-op */ } }
}
export function onFilterApplyComplete(cb) {
    applyCompleteListeners.add(cb)
    return () => { try { applyCompleteListeners.delete(cb) } catch { /* no-op */ } }
}

export function emitFilterFocusStart() {
    for (const cb of Array.from(focusStartListeners)) {
        try { cb() } catch (e) { /* ignore */ }
    }
}
export function emitFilterApplyComplete() {
    for (const cb of Array.from(applyCompleteListeners)) {
        try { cb() } catch (e) { /* ignore */ }
    }
}
