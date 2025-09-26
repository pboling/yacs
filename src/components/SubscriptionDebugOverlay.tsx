import React, { useEffect, useState } from 'react'
import { onSubscriptionMetricsChange, getSubscriptionMetrics } from '../subscription.lock.bus.js'

interface MetricsSnapshot {
  active: boolean
  allowed: string[]
  limits: { normal: number; fast: number; slow: number }
  counts: { fast: number; slow: number }
  fastKeys: string[]
  slowKeys: string[]
  visiblePaneCounts: Record<string, number>
  renderedPaneCounts: Record<string, number>
}

function useDebugMetrics() {
  const [snap, setSnap] = useState<MetricsSnapshot>(
    () => getSubscriptionMetrics() as MetricsSnapshot,
  )
  useEffect(() => {
    const off = onSubscriptionMetricsChange((s: MetricsSnapshot) => {
      setSnap(s)
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [])
  return snap
}

export default function SubscriptionDebugOverlay({ align = 'left' }: { align?: 'left' | 'right' }) {
  const snap = useDebugMetrics()
  return (
    <div
      style={
        {
          position: 'fixed',
          bottom: 8,
          [align]: 8,
          zIndex: 9999,
          fontSize: 11,
          background: 'rgba(17,24,39,0.85)',
          color: '#e5e7eb',
          padding: '8px 10px',
          border: '1px solid #374151',
          borderRadius: 6,
          maxWidth: 340,
          lineHeight: 1.35,
          fontFamily: 'ui-monospace, monospace',
        } as React.CSSProperties
      }
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Subscription Debug</div>
      <div>
        Lock: {snap.active ? 'ON' : 'off'} | Allowed: {snap.allowed.length} | Visible sum:{' '}
        {Object.values(snap.visiblePaneCounts).reduce((a, b) => a + b, 0)} | Rendered sum:{' '}
        {Object.values(snap.renderedPaneCounts).reduce((a, b) => a + b, 0)}
      </div>
      <div>
        Fast {snap.counts.fast}/{snap.limits.fast} (normal cap {snap.limits.normal}) | Slow{' '}
        {snap.counts.slow}/{snap.limits.slow}
      </div>
      <div style={{ marginTop: 4 }}>
        <span style={{ color: '#9ca3af' }}>Fast Keys (first 12):</span>{' '}
        {snap.fastKeys.slice(0, 12).join(', ') || '—'}
      </div>
      <div>
        <span style={{ color: '#9ca3af' }}>Slow Keys (first 12):</span>{' '}
        {snap.slowKeys.slice(0, 12).join(', ') || '—'}
      </div>
      <div style={{ marginTop: 4 }}>
        <span style={{ color: '#9ca3af' }}>Panes visible:</span>{' '}
        {Object.entries(snap.visiblePaneCounts)
          .map(([k, v]) => k + ':' + v)
          .join(' ')}
      </div>
      <div>
        <span style={{ color: '#9ca3af' }}>Panes rendered:</span>{' '}
        {Object.entries(snap.renderedPaneCounts)
          .map(([k, v]) => k + ':' + v)
          .join(' ')}
      </div>
      <div style={{ marginTop: 4, color: '#6b7280' }}>
        window.SUB_LOCK_DEBUG.getSnapshot() for full details.
      </div>
    </div>
  )
}
