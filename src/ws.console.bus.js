// ws.console.bus.js
// Lightweight pub/sub bus with in-memory history for WebSocket console messages
// Keeps history until explicitly cleared; consumers can subscribe to changes.

/** @typedef {'info'|'success'|'error'} WsConsoleLevel */

/**
 * @typedef {Object} WsConsoleEntry
 * @property {number} id
 * @property {number} ts
 * @property {WsConsoleLevel} level
 * @property {string} text
 */

/** @typedef {(entries: WsConsoleEntry[]) => void} Listener */

/** @type {WsConsoleEntry[]} */
const history = []
/** @type {Set<Listener>} */
const listeners = new Set()
let __seq = 0

function emit() {
  const snapshot = history.slice()
  for (const fn of listeners) {
    try {
      fn(snapshot)
    } catch {}
  }
}

/**
 * @param {Listener} fn
 * @returns {() => void}
 */
export function onWsConsoleChange(fn) {
  listeners.add(fn)
  try {
    fn(history.slice())
  } catch {}
  return () => listeners.delete(fn)
}

/** @returns {WsConsoleEntry[]} */
export function getWsConsoleHistory() {
  return history.slice()
}

export function clearWsConsole() {
  history.length = 0
  emit()
}

/**
 * @param {WsConsoleLevel} level
 * @param {string} text
 */
function push(level, text) {
  history.push({ id: ++__seq, ts: Date.now(), level, text })
  if (history.length > 2000) history.splice(0, history.length - 2000)
  emit()
}

/** @param {string} text */
export function logWsInfo(text) {
  push('info', text)
}
/** @param {string} text */
export function logWsSuccess(text) {
  push('success', text)
}
/** @param {string} text */
export function logWsError(text) {
  push('error', text)
}
