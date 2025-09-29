import { useEffect, useMemo, useRef, useState } from 'react'
import Sparkline from './Sparkline'
import { onUpdate } from '../updates.bus'

interface UpdateRateProps {
  rate?: number
  filterKey?: string | string[] | null
  version?: number
  width?: number
  height?: number
  title?: string
}

const UpdateRate: React.FC<UpdateRateProps> = ({ rate, filterKey, version, width = 120, height = 24, title }) => {
  const [series, setSeries] = useState<number[]>([])
  const counterRef = useRef(0)

  const keysArray = useMemo(
    () => (Array.isArray(filterKey) ? filterKey.filter(Boolean) : filterKey ? [filterKey] : []),
    [filterKey],
  )

  const keysSig = useMemo(() => keysArray.join('|'), [keysArray])

  useEffect(() => {
    const off = onUpdate((e) => {
      if (keysArray.length > 0 && !keysArray.includes(e.key)) return
      counterRef.current += 1
    })
    return () => {
      off()
    }
  }, [keysSig, keysArray])

  const [avgRate, setAvgRate] = useState(0)

  // Sample every 2s, convert to updates per minute, and keep a 5-minute rolling window (150 samples)
  useEffect(() => {
    const id = setInterval(() => {
      const count = counterRef.current
      counterRef.current = 0
      const perMin = (count / 2) * 60 // 2s sampling → per-second rate × 60 → per-minute
      setSeries((prev) => {
        const next = [...prev, perMin]
        if (next.length > 150) next.splice(0, next.length - 150) // 5 minutes @ 2s per sample
        return next
      })
    }, 2000)
    return () => {
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (series.length === 0) {
      setAvgRate(0)
      return
    }
    const sum = series.reduce((a, b) => a + b, 0)
    setAvgRate(sum / series.length)
  }, [series])

  const ver = useMemo(() => version ?? null, [version])

  // Use rate if provided, otherwise fallback to default logic
  const displayRate = rate

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {title && (
        <span className="muted" style={{ fontSize: 14 }}>
          {title}
        </span>
      )}
      <span
        className="muted"
        style={{ fontSize: 14 }}
        title="Average updates per minute over the last 5 minutes"
      >
        {avgRate.toFixed(2)} upd/min (5m avg)
      </span>
      <Sparkline data={series} width={width} height={height} />
      {ver != null && (
        <span className="muted" style={{ fontSize: 12 }}>
          (v{String(ver)})
        </span>
      )}
      {displayRate !== undefined && <div>{displayRate}</div>}
    </div>
  )
}

export default UpdateRate
