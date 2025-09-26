/**
 * Lightweight debug gating utility.
 * Default: OFF.
 * Enable via either:
 *  - URL param: ?debug=true
 *  - localStorage key: debug = "true"
 */
export function isDebugEnabled(): boolean {
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

export function debugLog(...args: unknown[]) {
    if (!isDebugEnabled()) return
    // eslint-disable-next-line no-console
    console.log(...args)
}
