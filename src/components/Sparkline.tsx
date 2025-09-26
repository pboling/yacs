import React from 'react'

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
  const max = Math.max(1, ...data)
  const min = 0
  const xStep = n > 1 ? (w - pad * 2) / (n - 1) : 0
  const points: string[] = []
  for (let i = 0; i < n; i++) {
    const x = pad + i * xStep
    const y = pad + (h - pad * 2) * (1 - (data[i] - min) / (max - min))
    points.push(String(x) + ',' + String(y))
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
