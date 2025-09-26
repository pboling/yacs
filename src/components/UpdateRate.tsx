import { useEffect, useMemo, useRef, useState } from 'react'
import Sparkline from './Sparkline'
import { onUpdate } from '../updates.bus'

export default function UpdateRate({ filterKey, version, width = 120, height = 24, title }: { filterKey?: string | string[] | null; version?: number; width?: number; height?: number; title?: string }) {
    const [series, setSeries] = useState<number[]>([])
    const counterRef = useRef(0)

    const keysArray = Array.isArray(filterKey) ? filterKey.filter(Boolean) : (filterKey ? [filterKey] : [])

    useEffect(() => {
        const off = onUpdate((e) => {
            if (keysArray.length > 0 && !keysArray.includes(e.key)) return
            counterRef.current += 1
        })
        return () => { off() }
    }, [keysArray.join('|')])

    const [avgRate, setAvgRate] = useState(0)

    useEffect(() => {
        const id = setInterval(() => {
            const count = counterRef.current
            counterRef.current = 0
            const perSec = count / 2 // 2s sampling → per-second rate
            setSeries((prev) => {
                const next = [...prev, perSec]
                if (next.length > 30) next.splice(0, next.length - 30)
                return next
            })
        }, 2000)
        return () => { clearInterval(id) }
    }, [])

    useEffect(() => {
        if (series.length === 0) { setAvgRate(0); return }
        const sum = series.reduce((a, b) => a + b, 0)
        setAvgRate(sum / series.length)
    }, [series])

    const ver = useMemo(() => (typeof version === 'number' ? version : null), [version])

    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {title && <span className="muted" style={{ fontSize: 14 }}>{title}</span>}
            <span className="muted" style={{ fontSize: 14 }} title="Average updates per second over the last 1 minute">
        {avgRate.toFixed(2)} upd/s (1m avg)
      </span>
            <Sparkline data={series} width={width} height={height} />
            {ver != null && (
                <span className="muted" style={{ fontSize: 12 }}>(v{String(ver)})</span>
            )}
        </div>
    )
}
