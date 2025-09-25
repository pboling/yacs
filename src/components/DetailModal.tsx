import { useEffect, useRef, useState } from 'react'
import AuditIcons from './AuditIcons'
import NumberCell from './NumberCell'
import UpdateRate from './UpdateRate'
import { onUpdate } from '../updates.bus'

export interface DetailModalRow {
  id: string
  tokenName: string
  tokenSymbol: string
  chain: string
  exchange: string
  priceUsd: number
  mcap: number
  volumeUsd: number
  priceChangePcs: { '5m': number; '1h': number; '6h': number; '24h': number }
  tokenCreatedTimestamp: Date
  transactions: { buys: number; sells: number }
  liquidity: { current: number; changePc: number }
  audit?: { contractVerified?: boolean; freezable?: boolean; honeypot?: boolean; linkDiscord?: string; linkTelegram?: string; linkTwitter?: string; linkWebsite?: string }
  security?: { renounced?: boolean; locked?: boolean; burned?: boolean }
  // Optional addresses to build WS correlation key for update-rate tracking
  tokenAddress?: string
  pairAddress?: string
}

export default function DetailModal({
  open,
  row,
  currentRow,
  onClose,
  getRowById,
}: {
  open: boolean
  row: DetailModalRow | null
  currentRow?: DetailModalRow | null
  onClose: () => void
  // returns the latest snapshot for the id (used to build in-modal history)
  getRowById: (id: string) => DetailModalRow | undefined
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Utility to check for debug=true in the URL
  function isDebugEnabled() {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('debug') === 'true'
  }
  const debugEnabled = isDebugEnabled()

  // Block page scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Build simple in-memory history while modal is open
  type SeriesKey = 'price' | 'mcap' | 'volume' | 'buys' | 'sells' | 'liquidity'
  const [history, setHistory] = useState<Record<SeriesKey, number[]>>({ price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] })

  // Reset series when a new row opens
  useEffect(() => {
    if (!open || !row) return
    setHistory({ price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] })
  }, [open, row])

  // Drive history updates directly from the per-key updates bus to align with actual WS cadence
  useEffect(() => {
    const pair = row?.pairAddress
    const token = row?.tokenAddress
    const chain = row?.chain
    if (!open || !pair || !token) return
    const key = `${pair}|${token}|${toChainId(chain)}`
    const off = onUpdate((e) => {
      try {
        if (e.key !== key) return
        const latest = currentRow ?? getRowById(row.id)
        if (!latest) return
        setHistory((prev) => ({
          price: [...prev.price, latest.priceUsd].slice(-300),
          mcap: [...prev.mcap, latest.mcap].slice(-300),
          volume: [...prev.volume, latest.volumeUsd].slice(-300),
          buys: [...prev.buys, latest.transactions.buys].slice(-300),
          sells: [...prev.sells, latest.transactions.sells].slice(-300),
          liquidity: [...prev.liquidity, latest.liquidity.current].slice(-300),
        }))
      } catch { /* no-op */ }
    })
    return () => { try { off() } catch { /* no-op */ } }
  }, [open, row, currentRow, getRowById])

  // (Removed) Fallback effect that appended to history on currentRow changes.
  // The onUpdate-driven effect above remains; no additional behavior changes.

  const seriesKeys: SeriesKey[] = ['price', 'mcap', 'volume', 'buys', 'sells', 'liquidity']

  const palette = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#22d3ee']

  const toChainId = (c: string | number | undefined): string => {
    if (c == null) return '1'
    const n = typeof c === 'number' ? c : Number(c)
    if (Number.isFinite(n)) return String(n)
    const s = String(c).toUpperCase()
    if (s === 'ETH') return '1'
    if (s === 'BSC') return '56'
    if (s === 'BASE') return '8453'
    if (s === 'SOL') return '900'
    return '1'
  }
  const header = row ? (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr', gap: 12, alignItems: 'center', marginBottom: 12 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {row.tokenName.toUpperCase()}/{row.tokenSymbol} / {row.chain}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Token</div>
      </div>
      <div>
        <div>{row.exchange}</div>
        <div className="muted" style={{ fontSize: 12 }}>Exchange</div>
      </div>
      <div>
        <div>
          <NumberCell noFade value={row.priceChangePcs['5m']} suffix="%" /> / <NumberCell noFade value={row.priceChangePcs['1h']} suffix="%" /> / <NumberCell noFade value={row.priceChangePcs['6h']} suffix="%" /> / <NumberCell noFade value={row.priceChangePcs['24h']} suffix="%" />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Chg (5m/1h/6h/24h)</div>
      </div>
      <div>
        <div>{formatAge(row.tokenCreatedTimestamp)}</div>
        <div className="muted" style={{ fontSize: 12 }}>Age</div>
      </div>
      <div>
        <AuditIcons flags={{
          verified: row.audit?.contractVerified,
          freezable: row.audit?.freezable,
          renounced: row.security?.renounced,
          locked: row.security?.locked,
          burned: row.security?.burned,
          honeypot: row.audit?.honeypot,
        }} />
      </div>
    </div>
  ) : null

  // Debug updates panel: capture raw JSON updates for this row
  const [updatesLog, setUpdatesLog] = useState<{ id: number; text: string }[]>([])
  const logRef = useRef<HTMLDivElement | null>(null)
  const logIdRef = useRef<number>(0)

  useEffect(() => {
    const pair = row?.pairAddress
    const token = row?.tokenAddress
    const chain = row?.chain
    if (!open || !pair || !token || !debugEnabled) return
    setUpdatesLog([])
    const key = `${pair}|${token}|${toChainId(chain)}`
    const off = onUpdate((e) => {
      try {
        if (e.key !== key) return
        const entry = JSON.stringify({ type: e.type, data: e.data })
        setUpdatesLog((prev) => {
          const next = [...prev, { id: ++logIdRef.current, text: entry }]
          if (next.length > 500) next.splice(0, next.length - 500)
          return next
        })
      } catch { /* no-op */ }
    })
    return () => { try { off() } catch { /* no-op */ } }
  }, [open, row, debugEnabled])

  useEffect(() => {
    try {
      const el = logRef.current
      if (el) { el.scrollTop = el.scrollHeight }
    } catch { /* no-op */ }
  }, [updatesLog])

  // Build per-series relative scaling spark paths
  function buildPath(vals: number[], width = 600, height = 120) {
    const pad = 4
    const w = width
    const h = height
    const n = vals.length
    if (n === 0) return ''
    // Use per-series relative scaling: true min/max of the series, not clamped to 0.
    // This makes subtle movements visible even for large positive-only values.
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const range = Math.max(1e-6, max - min)
    const xStep = n > 1 ? (w - pad * 2) / (n - 1) : 0
    const pts: string[] = []
    for (let i = 0; i < n; i++) {
      const x = pad + i * xStep
      const y = pad + (h - pad * 2) * (1 - (vals[i] - min) / range)
      pts.push(String(x) + ',' + String(y))
    }
    return pts.length > 0 ? 'M ' + pts.join(' L ') : ''
  }

  // Utility to safely format numbers for display
  function safeNumberFormat(val: unknown, digits = 0) {
    return typeof val === 'number' && Number.isFinite(val)
      ? digits > 0
        ? val.toFixed(digits)
        : val.toLocaleString()
      : '—'
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: open ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(8px)',
        background: 'rgba(0,0,0,0.48)'
      }}
      onClick={(e) => { if (e.target === wrapperRef.current) onClose() }}
      ref={wrapperRef}
    >
      <div style={{
        position: 'relative', width: '100%', height: '100%', maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 40px)',
        border: '1px solid #374151', borderRadius: 8, background: 'rgba(17,24,39,0.8)', overflow: 'auto', padding: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Details</div>
            {row?.pairAddress && row.tokenAddress && (
              <UpdateRate
                title="Live rate"
                version={undefined}
                filterKey={`${row.pairAddress}|${row.tokenAddress}|${toChainId(row.chain)}`}
              />
            )}
          </div>
          <button type="button" onClick={onClose} style={{ background: 'transparent', color: 'inherit', border: '1px solid #4b5563', borderRadius: 4, padding: '4px 8px' }}>Close</button>
        </div>
        {header}
        {/* Combined multi-line sparkline */}
        <div style={{ borderTop: '1px solid #374151', paddingTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Live history (relative scale per metric)</div>
          <div style={{ position: 'relative', width: '100%', height: 140 }}>
            <svg width="100%" height="140" viewBox={`0 0 600 140`} preserveAspectRatio="none">
              <polyline points={`4,136 596,136`} stroke="#374151" strokeWidth="1" fill="none" />
              {seriesKeys.map((k, i) => {
                const vals = history[k]
                const d = buildPath(vals, 600, 140)
                if (!d) return null
                return <path key={k} d={d} stroke={palette[i % palette.length]} strokeWidth={1.5} fill="none" />
              })}
            </svg>
          </div>
        </div>
        {/* Debug panel at the bottom */}
        {debugEnabled && row?.pairAddress && row.tokenAddress && (
          <div style={{ marginTop: 12, borderTop: '1px solid #374151', paddingTop: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Debug updates (raw JSON)</div>
            <div ref={logRef} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize: 11, background: 'rgba(0,0,0,0.35)', border: '1px solid #374151', borderRadius: 6, padding: 8, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre', lineHeight: 1.4 }}>
              {updatesLog.length === 0 ? (
                <div className="muted">No updates yet…</div>
              ) : (
                updatesLog.map((item) => (
                  <div key={item.id}>{item.text}</div>
                ))
              )}
            </div>
          </div>
        )}
        {/* Burn-related details */}
        <div style={{ marginTop: 12, borderTop: '1px solid #374151', paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Burn Details</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div><span className="muted">Total Supply:</span> {safeNumberFormat(row?.totalSupply)}</div>
            <div><span className="muted">Burned Supply:</span> {safeNumberFormat(row?.burnedSupply)}</div>
            <div><span className="muted">Percent Burned:</span> {typeof row?.percentBurned === 'number' && Number.isFinite(row.percentBurned) ? `${safeNumberFormat(row.percentBurned, 2)}%` : '—'}</div>
            <div><span className="muted">Dead Address:</span> <span style={{ fontFamily: 'monospace' }}>{typeof row?.deadAddress === 'string' ? row.deadAddress : '—'}</span></div>
            <div><span className="muted">Owner Address:</span> <span style={{ fontFamily: 'monospace' }}>{typeof row?.ownerAddress === 'string' ? row.ownerAddress : '—'}</span></div>
            <div><span className="muted">Burned Status:</span> {row?.security?.burned === true ? 'Burned' : row?.security?.burned === false ? 'Not Burned' : 'Unknown'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatAge(d: Date) {
  try {
    const ms = Date.now() - new Date(d).getTime()
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const ss = s % 60
    if (h > 0) return String(h) + 'h ' + String(m) + 'm'
    if (m > 0) return String(m) + 'm ' + String(ss) + 's'
    return String(ss) + 's'
  } catch {
    return ''
  }
}
