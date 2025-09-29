import { useState } from 'react'

export default function Toast({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true)
  if (!visible) return null
  return (
    <div
      style={{
        background: '#f59e42',
        color: '#222',
        border: '1px solid #eab308',
        borderRadius: 8,
        padding: '10px 16px',
        margin: '8px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 15,
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        zIndex: 1000,
      }}
    >
      <span style={{ flex: 1 }}>{children}</span>
      <button
        onClick={() => {
          setVisible(false)
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#222',
          fontWeight: 'bold',
          fontSize: 18,
          cursor: 'pointer',
        }}
        aria-label="Dismiss warning"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
