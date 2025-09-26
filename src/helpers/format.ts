/**
 * Shared formatting helpers used across components.
 *
 * formatAge: Convert a timestamp-like input into a compact relative age string.
 * - < 60 minutes → Xm
 * - < 24 hours   → Xh
 * - otherwise    → Xd
 *
 * Accepts Date | number (ms) | string (Date-parsable) for convenience.
 */
export function formatAge(input: Date | number | string): string {
  let ts: Date
  if (input instanceof Date) {
    ts = input
  } else if (typeof input === 'number') {
    ts = new Date(input)
  } else if (typeof input === 'string') {
    // Fallback: attempt to parse
    const d = new Date(input)
    ts = Number.isFinite(d.getTime()) ? d : new Date()
  } else {
    ts = new Date()
  }
  const now = Date.now()
  const diff = Math.max(0, now - ts.getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return String(mins) + 'm'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return String(hrs) + 'h'
  const days = Math.floor(hrs / 24)
  return String(days) + 'd'
}
