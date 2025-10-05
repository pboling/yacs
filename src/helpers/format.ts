/**
 * Shared formatting helpers used across components.
 *
 * formatAge: Convert a timestamp-like input into a compact relative age string.
 * Policy: render using ``/`/h/d/m/y with one decimal place (similar to K/M/B/T):
 * - < 1 minute → X.Y`` (seconds)
 * - < 1 hour   → X.Y`  (minutes)
 * - < 1 day    → X.Yh  (hours)
 * - < 30 days  → X.Yd  (days)
 * - < 365 days → X.Ym  (months, 30-day months)
 * - otherwise  → X.Yy  (years, 365-day years)
 *
 * Accepts Date | number (ms) | string (Date-parsable) for convenience.
 */
export function formatAge(input: Date | number | string): string {
  let ts: Date
  if (input instanceof Date) {
    ts = input
  } else if (typeof input === 'number') {
    ts = new Date(input)
  } else {
    // At this point TypeScript knows input is a string
    const d = new Date(input)
    ts = Number.isFinite(d.getTime()) ? d : new Date()
  }
  const now = Date.now()
  const diffMs = Math.max(0, now - ts.getTime())
  const secondMs = 1000
  const minuteMs = 60 * secondMs
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  const monthMs = 30 * dayMs
  const yearMs = 365 * dayMs

  // Seconds
  if (diffMs < minuteMs) {
    const seconds = diffMs / secondMs
    return seconds.toFixed(1) + '``'
  }
  // Minutes
  if (diffMs < hourMs) {
    const minutes = diffMs / minuteMs
    return minutes.toFixed(1) + '`'
  }
  // Hours
  if (diffMs < dayMs) {
    const hours = diffMs / hourMs
    return hours.toFixed(1) + 'h'
  }
  // Days (< 30d)
  if (diffMs < monthMs) {
    const days = diffMs / dayMs
    return days.toFixed(1) + 'd'
  }
  // Months (< 365d)
  if (diffMs < yearMs) {
    const months = diffMs / monthMs
    return months.toFixed(1) + 'm'
  }
  // Years
  const years = diffMs / yearMs
  return years.toFixed(1) + 'y'
}

/**
 * Truncate a string to a maximum length and append ellipsis (…) if truncated.
 *
 * @param input - The string to truncate
 * @param length - Maximum length (default: 5)
 * @returns Truncated string with ellipsis if needed
 */
export function ellipsed(input: string, length = 5): string {
  if (length <= 0) return ''
  if (input.length <= length) return input
  return input.slice(0, Math.max(1, length - 1)) + '…'
}
