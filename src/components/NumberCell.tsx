import { useEffect, useRef, useState } from 'react'

// Reusable cell that colors number green/red based on change vs previous render
export default function NumberCell({
  value,
  prefix = '',
  suffix = '',
  formatter,
  stableMs,
  noFade = false,
}: {
  value: number | string
  prefix?: string
  suffix?: string
  formatter?: (n: number) => string
  stableMs?: number
  noFade?: boolean
}) {
  const num = typeof value === 'number' ? value : Number(value)
  const prevValRef = useRef<number | null>(null)
  const appliedClassRef = useRef<'' | 'up' | 'down'>('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, force] = useState(0)

  // Determine class
  let desiredClass: '' | 'up' | 'down' = ''
  if (noFade) {
    // For noFade cells (e.g., percentage change), color by sign consistently
    if (Number.isFinite(num)) {
      desiredClass = num > 0 ? 'up' : num < 0 ? 'down' : ''
    }
  } else {
    // Default behavior: color based on trend vs previous value and allow fade
    let rawTrend: '' | 'up' | 'down' = ''
    if (Number.isFinite(num) && prevValRef.current !== null) {
      if (num > prevValRef.current) rawTrend = 'up'
      else if (num < prevValRef.current) rawTrend = 'down'
    }
    // If value is unchanged, keep whatever color was previously applied
    desiredClass = rawTrend === '' ? appliedClassRef.current : rawTrend
  }
  appliedClassRef.current = desiredClass

  // Update previous numeric value after render
  useEffect(() => {
    if (Number.isFinite(num)) prevValRef.current = num
  }, [num])

  // Manage auto-clear back to white after a stable period without trend changes
  useEffect(() => {
    if (noFade) return
    const defaultStable = Number(import.meta.env.VITE_STABLE_COLOR_MS ?? '600000')
    const holdMs = typeof stableMs === 'number' && stableMs > 0 ? stableMs : defaultStable

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (desiredClass === 'up' || desiredClass === 'down') {
      timeoutRef.current = setTimeout(() => {
        appliedClassRef.current = ''
        // force a re-render to apply the cleared class
        force((n) => n + 1)
      }, holdMs)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [desiredClass, stableMs, noFade])

  // Format number with abbreviation logic (K/M/B/T) and cap precision
  let text: string
  let title: string | undefined
  if (Number.isFinite(num)) {
    const absNum = Math.abs(num)

    // Tooltip: full number up to 15 significant digits (no grouping)
    const fullFmt = new Intl.NumberFormat('en-US', {
      maximumSignificantDigits: 15,
      useGrouping: false,
    })
    const fullStr = fullFmt.format(num)
    title = `${prefix}${fullStr}${suffix}`

    if (formatter) {
      // Even if a custom formatter is provided, still cap visible precision by post-formatting
      const raw = formatter(num)
      // Attempt to extract numeric portion to cap to 4 significant digits; if not numeric, use as-is
      const nf = new Intl.NumberFormat('en-US', {
        maximumSignificantDigits: 4,
        useGrouping: false,
      })
      const parsed = Number(raw.replace(/[^0-9eE+\-.]/g, ''))
      if (Number.isFinite(parsed)) {
        text = raw.replace(/([0-9eE+\-.]+)/, nf.format(parsed))
      } else {
        text = raw
      }
    } else {
      const nfNum = new Intl.NumberFormat('en-US', {
        maximumSignificantDigits: 4,
        useGrouping: false,
      })
      const abbreviate = (n: number) => {
        let divisor = 1
        let suffixLocal = ''
        if (absNum >= 1_000_000_000_000) {
          divisor = 1_000_000_000_000
          suffixLocal = 'T'
        } else if (absNum >= 1_000_000_000) {
          divisor = 1_000_000_000
          suffixLocal = 'B'
        } else if (absNum >= 1_000_000) {
          divisor = 1_000_000
          suffixLocal = 'M'
        } else if (absNum >= 1_000) {
          divisor = 1_000
          suffixLocal = 'K'
        }
        if (divisor === 1) {
          // For very small numbers, switch to scientific notation to avoid excessively long decimals
          if (absNum > 0 && absNum < 1e-2) {
            const sci = n.toExponential(3) // 4 significant digits total
            return sci.replace(/e\+?(-?\d+)/i, 'e$1')
          }
          return nfNum.format(n)
        }
        const scaled = n / divisor
        // Format scaled number to 4 significant digits and strip trailing zeros after decimal
        let s = nfNum.format(scaled)
        s = s.replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '')
        return s + suffixLocal
      }
      text = abbreviate(num)
    }
  } else {
    text = String(value)
    title = undefined
  }

  return (
    <span className={appliedClassRef.current} title={title}>
      {prefix}
      {text}
      {suffix}
    </span>
  )
}
