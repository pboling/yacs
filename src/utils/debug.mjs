/**
 * JS shim for Node/test ESM resolution.
 * Mirrors the runtime behavior of src/utils/debug.ts but without types.
 * Node's ESM resolver cannot import .ts files; providing this .mjs keeps tests working
 * while TS code can continue importing `./utils/debug` and get the .ts source in Vite.
 */
export function isDebugEnabled() {
  if (typeof window === 'undefined') return false
  try {
    const search = new URLSearchParams(window.location.search)
    const qp = search.get('debug')
    if (qp != null) return qp === 'true'
  } catch {
    // ignore
  }
  try {
    const ls = window.localStorage.getItem('debug')
    if (ls != null) return ls === 'true'
  } catch {
    // ignore
  }
  return false
}

export function debugLog(...args) {
  if (!isDebugEnabled()) return
  try {
    console.log(...args)
  } catch {
    // ignore
  }
}
