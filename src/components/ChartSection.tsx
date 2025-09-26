import React, { useEffect } from 'react'
import NumberCell from './NumberCell'

export interface ChartSectionProps {
  title: string
  history: Record<string, number[]>
  palette: Record<string, string>
  selectedMetric: string
  seriesKeys: string[]
  seriesLabels: Record<string, string>
  focusOrder: string[] // order for legend priority
  symbol: string
  buildPath: (vals: number[], width?: number, height?: number) => string
  showMetricChooser?: boolean
  onChangeMetric?: (m: string) => void
  metricOptions?: { key: string; label: string }[]
  height?: number
  emptyMessage?: string
}

export const ChartSection: React.FC<ChartSectionProps> = ({
  title,
  history,
  palette,
  selectedMetric,
  seriesKeys,
  seriesLabels,
  focusOrder,
  symbol,
  buildPath,
  showMetricChooser = false,
  onChangeMetric,
  metricOptions = [
    { key: 'price', label: 'Price' },
    { key: 'mcap', label: 'Market Cap' },
  ],
  height = 140,
  emptyMessage = 'No data yet'
}) => {
  const hasData = seriesKeys.some(k => (history[k] || []).length > 0)

  // Inject keyframes once
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    if ((window as any).__chartSectionStylesInjected) return
    const style = document.createElement('style')
    style.textContent = `@keyframes chart-skel {0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`
    document.head.appendChild(style)
    ;(window as any).__chartSectionStylesInjected = true
  }, [])

  // Only render two spark lines: selected metric (Price or Market Cap) and Liquidity
  const displayedSeriesKeys = Array.from(new Set([
    selectedMetric,
    'liquidity'
  ])).filter(k => seriesKeys.includes(k))

  const latestVal = (k: string): number | string => {
    const vals = history[k] || []
    return vals.length ? vals[vals.length - 1] : '—'
  }

  return (
    <div style={{ borderTop: '1px solid #374151', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        {showMetricChooser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 12 }}>focus:</span>
            {metricOptions.map(opt => (
              <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: selectedMetric === opt.key ? 700 : 400, color: selectedMetric === opt.key ? palette[opt.key] : undefined }}>
                <input
                  type="radio"
                  name={`metric-${title}`}
                  value={opt.key}
                  checked={selectedMetric === opt.key}
                  onChange={() => onChangeMetric?.(opt.key)}
                  style={{ accentColor: palette[opt.key] }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )}
        {/* Inline numeric stats for other values (always shown) */}
        <span style={{ width: 1, height: 16, background: '#374151', display: 'inline-block', margin: '0 4px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="muted">Vol</span>
            <NumberCell value={latestVal('volume')} prefix={Number.isFinite(Number(latestVal('volume'))) ? '$' : ''} formatter={n => (Math.abs(n) >= 1e9 ? n.toExponential(2) : Math.round(n).toLocaleString())} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="muted">Buys</span>
            <NumberCell value={latestVal('buys')} formatter={n => Math.round(n).toLocaleString()} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="muted">Sells</span>
            <NumberCell value={latestVal('sells')} formatter={n => Math.round(n).toLocaleString()} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>(Not Graphed)</span>
          </span>
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', height }}>
        {!hasData && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9ca3af', background: 'linear-gradient(90deg, #1f2937 0%, #111827 50%, #1f2937 100%)', backgroundSize: '200% 100%', animation: 'chart-skel 3s linear infinite', borderRadius: 4 }}>
            {emptyMessage}
          </div>
        )}
        <svg width="100%" height={height} viewBox={`0 0 600 ${height}`} preserveAspectRatio="none" style={{ opacity: hasData ? 1 : 0.4 }}>
          <polyline points={`4,${height - 4} ${600 - 4},${height - 4}`} stroke="#374151" strokeWidth="1" fill="none" />
          {displayedSeriesKeys.map(k => {
            const vals = history[k] || []
            const d = buildPath(vals, 600, height)
            if (!d) return null
            return (
              <path
                key={k}
                d={d}
                stroke={palette[k]}
                strokeWidth={k === selectedMetric ? 3 : 2}
                fill="none"
                style={k === selectedMetric ? { filter: `drop-shadow(0 0 2px ${palette[k]}88)` } : {}}
              />
            )
          })}
        </svg>
      </div>
      {/* Legend (always show Price, Market Cap, Liquidity even if only two lines rendered) */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8, fontSize: 13 }}>
        {focusOrder.map(k => {
          const vals = history[k] || []
          const latest = vals.length > 0 ? vals[vals.length - 1] : '—'
          let prefix = ''
          let formatter: ((n: number) => string) | undefined = undefined
          if (k === 'price') {
            prefix = '$'
            formatter = n => (Math.abs(n) >= 1e9 ? n.toExponential(2) : n.toFixed(8))
          } else if (k === 'mcap' || k === 'liquidity') {
            prefix = '$'
            formatter = n => (Math.abs(n) >= 1e9 ? n.toExponential(2) : Math.round(n).toLocaleString())
          }
          return (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: k === selectedMetric ? 700 : 400, color: palette[k] }}>
              <span style={{ width: 18, height: 3, background: palette[k], display: 'inline-block', borderRadius: 2 }} />
              <span>{seriesLabels[k]} ({symbol})</span>
              <NumberCell value={latest} prefix={prefix} formatter={formatter} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default ChartSection
