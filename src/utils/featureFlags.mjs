/**
 * Feature flags utility (runtime-only, ESM JS for broad compatibility)
 *
 * Currently supported flags:
 * - tiered-channel: gates usage of non-standard WS channels (fast/slow/X5, append, wpeg-prices)
 *   Default: OFF.
 *   Enable via either URL param ?tiered-channel=true or localStorage['tiered-channel']='true'.
 */
export function isTieredChannelEnabled() {
  if (typeof window === 'undefined') return false
  try {
    const sp = new URLSearchParams(window.location.search)
    const qp = sp.get('tiered-channel')
    if (qp != null) return qp === 'true'
  } catch {
    // ignore
  }
  try {
    const ls = window.localStorage.getItem('tiered-channel')
    if (ls != null) return ls === 'true'
  } catch {
    // ignore
  }
  return false
}
