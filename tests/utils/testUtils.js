// tests/utils/testUtils.js
// Deterministic timeout wrapper for node:test suites to prevent hangs
// and provide diagnostics on timeout.

/**
 * Dump currently active Node handles/requests for diagnostics.
 * Safe across Node versions; uses internal APIs if available.
 */
export function dumpActiveHandles(prefix = 'Diagnostics') {
  try {
     
    const getHandles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles : null
     
    const getReqs = typeof process._getActiveRequests === 'function' ? process._getActiveRequests : null
    const handles = getHandles ? getHandles.call(process) : []
    const reqs = getReqs ? getReqs.call(process) : []
    // Avoid throwing if console is stubbed
    try {
      // Only print a compact summary to keep CI logs readable
      console.error(`[${prefix}] active handles: ${handles.length}, active requests: ${reqs.length}`)
      for (const h of handles) {
        const name = h && h.constructor ? h.constructor.name : String(h)
        // Best-effort info for timers/sockets
        if (name === 'Timeout' || name === 'Immediate') {
          console.error(`[${prefix}] handle: ${name}`)
        } else if (name === 'Socket') {
          // @ts-ignore - not typed in JS tests
          const remote = h.remoteAddress ? `${h.remoteAddress}:${h.remotePort}` : ''
          console.error(`[${prefix}] handle: ${name} ${remote}`)
        } else {
          console.error(`[${prefix}] handle: ${name}`)
        }
      }
    } catch {
      // no-op
    }
  } catch {
    // ignore
  }
}

/**
 * Wrap an async test body with a deterministic timeout. On timeout,
 * attempt to dump active handles for easier debugging and then throw.
 */
export async function withDeterministicTimeout(fn, timeoutMs = 12_000) {
  let to
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        to = setTimeout(() => {
          try { dumpActiveHandles('withDeterministicTimeout') } catch {}
          reject(new Error(`deterministic timeout after ${timeoutMs}ms`))
        }, timeoutMs)
        // Do not keep the process alive solely due to this timer
        // @ts-ignore - unref may not exist in some environments
        if (typeof to?.unref === 'function') {
          try { to.unref() } catch {}
        }
      }),
    ])
  } finally {
    if (to) clearTimeout(to)
  }
}
