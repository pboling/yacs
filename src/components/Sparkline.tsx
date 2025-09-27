export default function Sparkline({
  data,
  width = 120,
  height = 24,
}: {
  data: number[]
  width?: number
  height?: number
}) {
  const pad = 2
  const w = width
  const h = height
  const n = data.length
  if (n === 0) {
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
        <polyline
          points={`${pad},${h - pad} ${w - pad},${h - pad}`}
          stroke="#374151"
          strokeWidth="1"
          fill="none"
        />
      </svg>
    )
  }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = Math.max(1e-6, max - min)
  const xStep = n > 1 ? (w - pad * 2) / (n - 1) : 0
  const points: string[] = []
  if (n === 1) {
    const y = pad + (h - pad * 2) * (1 - (data[0] - min) / range)
    points.push(`${pad},${y}`)
    points.push(`${w - pad},${y}`)
  } else {
    for (let i = 0; i < n; i++) {
      const x = pad + i * xStep
      const y = pad + (h - pad * 2) * (1 - (data[i] - min) / range)
      points.push(String(x) + ',' + String(y))
    }
  }
  const path = points.length > 0 ? 'M ' + points.join(' L ') : ''
  const viewBox = '0 0 ' + String(w) + ' ' + String(h)
  const baseLine =
    String(pad) + ',' + String(h - pad) + ' ' + String(w - pad) + ',' + String(h - pad)
  return (
    <svg width={w} height={h} viewBox={viewBox} aria-hidden="true" focusable="false">
      <polyline points={baseLine} stroke="#374151" strokeWidth="1" fill="none" />
      {path && <path d={path} stroke="#10b981" strokeWidth="1.5" fill="none" />}
    </svg>
  )
}
