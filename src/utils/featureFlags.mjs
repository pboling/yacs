/**
 * Feature flags utility (runtime-only, ESM JS for broad compatibility)
 *
 * Note: All experimental flags and non-standard WS channels have been removed.
 * This stub remains only for backwards compatibility and always returns false.
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
