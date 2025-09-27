export default function SubscriptionDebugOverlay({ align = 'left' }: { align?: 'left' | 'right' }) {
  // Metrics overlay removed. Keeping a tiny stub to avoid breaking imports if re-enabled elsewhere.
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: align === 'left' ? 8 : undefined,
        right: align === 'right' ? 8 : undefined,
        zIndex: 9999,
        fontSize: 11,
        background: 'rgba(17,24,39,0.85)',
        color: '#e5e7eb',
        padding: '6px 8px',
        border: '1px solid #374151',
        borderRadius: 6,
        lineHeight: 1.35,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ fontWeight: 600 }}>Subscription Debug disabled</div>
    </div>
  )
}
