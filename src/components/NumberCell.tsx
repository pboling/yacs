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
        const defaultStable = Number(import.meta.env.VITE_STABLE_COLOR_MS ?? '10000')
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

    // Format number with scientific notation if whole-number part has more than 9 digits
    let text: string
    if (Number.isFinite(num)) {
        const absNum = Math.abs(num)
        if (absNum >= 1_000_000_000) {
            // Use scientific notation with 6 significant digits for readability
            text = num.toExponential(6)
        } else {
            text = formatter ? formatter(num) : String(num)
        }
    } else {
        text = String(value)
    }

    return <span className={appliedClassRef.current}>{prefix}{text}{suffix}</span>
}
