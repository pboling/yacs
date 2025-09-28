export default function Sparkline({
  data,
  width = undefined,
  height = 24,
  pad = 2,
  strokeColor = '#10b981',
  strokeWidth = 1.5,
  showDots = true,
  baseline = true,
  offsetPx = 0,
  viewBoxWidth = undefined,
  ariaLabel = 'sparkline',
  onClick = undefined,
  multiplier = 1,
}: {
  data: number[]
  width?: number | string | undefined
  height?: number
  pad?: number
  strokeColor?: string
  strokeWidth?: number
  showDots?: boolean
  baseline?: boolean
  // horizontal offset to translate paths by (px)
  offsetPx?: number
  // when provided, use this value as the viewBox width and for x-step calculations; otherwise compute from data length
  viewBoxWidth?: number | undefined
  ariaLabel?: string
  onClick?: (() => void) | undefined
  multiplier?: number
}) {
  const wComputed = (() => {
    const n = data.length
    if (typeof viewBoxWidth === 'number') return viewBoxWidth
    // default width heuristic similar to Row: at least 60, else 2px per point
    return Math.max(60, Math.max(1, n) * 2)
  })()
  const h = height
  const n = data.length
  if (n === 0) {
    return (
      <svg
        width={width}
        height={h}
        viewBox={`0 0 ${wComputed} ${h}`}
        aria-hidden={ariaLabel ? 'false' : 'true'}
        role="img"
      >
        {baseline ? (
          <polyline
            points={`${pad},${h - pad} ${wComputed - pad},${h - pad}`}
            stroke="#374151"
            strokeWidth="1"
            fill="none"
          />
        ) : null}
      </svg>
    )
  }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = Math.max(1e-6, max - min)
  const xStep = n > 1 ? (wComputed - pad * 2) / (n - 1) : 0
  const points: { x: number; y: number }[] = []
  if (n === 1) {
    const y = pad + (h - pad * 2) * (1 - (data[0] - min) / range)
    points.push({ x: pad, y })
    points.push({ x: wComputed - pad, y })
  } else {
    for (let i = 0; i < n; i++) {
      const x = pad + i * xStep
      const y = pad + (h - pad * 2) * (1 - (data[i] - min) / range)
      points.push({ x, y })
    }
  }
  const path = points.length > 0 ? 'M ' + points.map((p) => `${p.x},${p.y}`).join(' L ') : ''
  // Apply visual multiplier to stroke/dot sizing so callers can scale the graph via props or CSS var
  const effectiveStrokeWidth = Math.max(
    0.5,
    strokeWidth * (Number.isFinite(multiplier) ? multiplier : 1),
  )
  const effectiveDotRadius = Math.max(0.5, effectiveStrokeWidth)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{ background: 'transparent', border: 0, padding: 0, margin: 0, width: '100%' }}
    >
      <svg
        width={width}
        height={h}
        viewBox={`0 0 ${wComputed} ${h}`}
        preserveAspectRatio="none"
        role="img"
      >
        {baseline ? (
          <polyline
            points={`${pad},${h - pad} ${wComputed - pad},${h - pad}`}
            stroke="#374151"
            fill="none"
          />
        ) : null}
        {path && (
          <path
            d={path}
            stroke={strokeColor}
            strokeWidth={effectiveStrokeWidth}
            fill="none"
            transform={`translate(${-offsetPx}, 0)`}
          />
        )}
        {showDots && (
          <g transform={`translate(${-offsetPx}, 0)`}>
            {points.map((p) => (
              <circle
                key={`${p.x}-${p.y}`}
                cx={p.x}
                cy={p.y}
                r={effectiveDotRadius}
                fill={strokeColor}
              />
            ))}
          </g>
        )}
      </svg>
    </button>
  )
}
