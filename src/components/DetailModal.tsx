import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import UpdateRate from './UpdateRate'
import { onUpdate } from '../updates.bus'
import { engageSubscriptionLock } from '../subscription.lock.bus.js'
import ChartSection from './ChartSection'
import NumberCell from './NumberCell'
import useCompareSubscription from '../hooks/useCompareSubscription'
import { toChainId } from '../utils/chain'
import { buildPairKey, buildTickKey } from '../utils/key_builder'
import { computeFilteredCompareOptions } from '../utils/filteredCompareOptions.mjs'

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
  audit?: {
    contractVerified?: boolean
    freezable?: boolean
    honeypot?: boolean
    linkDiscord?: string
    linkTelegram?: string
    linkTwitter?: string
    linkWebsite?: string
  }
  security?: { renounced?: boolean; locked?: boolean }
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
  allRows,
}: {
  open: boolean
  row: DetailModalRow | null
  currentRow?: DetailModalRow | null
  onClose: () => void
  // returns the latest snapshot for the id (used to build in-modal history)
  getRowById: (id: string) => DetailModalRow | undefined
  allRows: DetailModalRow[]
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
    if (!open) {
      try {
        document.body.setAttribute('data-detail-open', '0')
      } catch {}
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    try {
      document.body.setAttribute('data-detail-open', '1')
    } catch {}
    return () => {
      document.body.style.overflow = prev
      try {
        document.body.setAttribute('data-detail-open', '0')
      } catch {}
    }
  }, [open])

  // Build simple in-memory history while modal is open
  type SeriesKey = 'price' | 'mcap' | 'volume' | 'buys' | 'sells' | 'liquidity'
  // Added constant lists / labels (were previously implicit)
  const seriesKeys: SeriesKey[] = ['price', 'mcap', 'volume', 'buys', 'sells', 'liquidity']
  const seriesLabels: Record<SeriesKey, string> = {
    price: 'Price',
    mcap: 'Market Cap',
    volume: 'Volume',
    buys: 'Buys',
    sells: 'Sells',
    liquidity: 'Liquidity',
  }

  const [history, setHistory] = useState<Record<SeriesKey, number[]>>({
    price: [],
    mcap: [],
    volume: [],
    buys: [],
    sells: [],
    liquidity: [],
  })
  const [history2, setHistory2] = useState<Record<SeriesKey, number[]>>({
    price: [],
    mcap: [],
    volume: [],
    buys: [],
    sells: [],
    liquidity: [],
  })
  // Track display order swap (visual only)
  const [reversed, setReversed] = useState(false)

  // Base/Compare selection state
  const [baseId, setBaseId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  // Persist selections
  useEffect(() => {
    try {
      if (baseId) window.localStorage.setItem('detailModal.baseId', baseId)
      else window.localStorage.removeItem('detailModal.baseId')
    } catch {
      /* no-op */
    }
  }, [baseId])
  useEffect(() => {
    try {
      if (compareId) window.localStorage.setItem('detailModal.compareId', compareId)
      else window.localStorage.removeItem('detailModal.compareId')
    } catch {
      /* no-op */
    }
  }, [compareId])

  // Initialize baseId and reset series when base (primary) changes
  useEffect(() => {
    if (!open) return
    // Initialize baseId from provided row or persisted value
    if (row?.id) {
      if (baseId !== row.id) setBaseId(row.id)
    } else if (!baseId) {
      try {
        const stored =
          typeof window !== 'undefined' ? window.localStorage.getItem('detailModal.baseId') : null
        if (stored) setBaseId(stored)
      } catch {}
    }
  }, [open, row?.id, baseId])
  // Reset series when a new primary row opens (only when id changes)
  const baseRow = resolveCompareRow(baseId)
  const primaryRow = row ?? baseRow
  useEffect(() => {
    if (!open || !primaryRow?.id) return
    setHistory({ price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] })
    setHistory2({ price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] })
    setReversed(false)
  }, [open, primaryRow?.id])

  // Manage persisted compare selection without wiping history on table updates
  useEffect(() => {
    if (!open || !row?.id) return
    try {
      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem('detailModal.compareId') : null
      if (stored && stored !== row.id) {
        const exists = allRows.some((r) => r.id === stored)
        if (exists) {
          if (compareId !== stored) setCompareId(stored)
          return
        }
      }
    } catch {
      /* no-op */
    }
    if (compareId !== null) setCompareId(null)
  }, [open, row?.id, allRows, compareId])

  // Seed initial base snapshot so chart isn't empty while waiting for first WS update (id-based)
  useEffect(() => {
    if (!open || !primaryRow?.id) return
    setHistory((prev) => (prev.price.length > 0 ? prev : seedFromRow(primaryRow)))
    // We intentionally seed only when id changes to avoid re-seeding on live updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, primaryRow?.id])

  const [compareSearch, setCompareSearch] = useState('')
  const [showCompareList, setShowCompareList] = useState(false)
  // Freshness filters for selection menus (fresh always included)
  const [includeStale, setIncludeStale] = useState(false)
  const [includeDegraded, setIncludeDegraded] = useState(false)

  // Reset transient selector state when modal opens or when base row changes
  useEffect(() => {
    if (!open) return
    // Clear any stale search text from prior modal sessions to avoid accidental filtering
    setBaseSearch('')
    setCompareSearch('')
    // Start with menus closed
    setShowBaseList(false)
    setShowCompareList(false)
  }, [open, row?.id])
  const ONE_HOUR_MS = 60 * 60 * 1000
  const freshnessOf = useCallback(
    (r: DetailModalRow): 'fresh' | 'stale' | 'degraded' => {
      interface Timestamps {
        scannerAt?: unknown
        tickAt?: unknown
        pairStatsAt?: unknown
      }
      const ts = r as unknown as Timestamps
      const s = typeof ts.scannerAt === 'number' ? ts.scannerAt : null
      const t = typeof ts.tickAt === 'number' ? ts.tickAt : null
      const p = typeof ts.pairStatsAt === 'number' ? ts.pairStatsAt : null
      const hasAny = [s, t, p].some((v) => v != null)
      if (!hasAny) return 'degraded'
      const now = Date.now()
      const recent = [s, t, p].some((v) => typeof v === 'number' && now - v < ONE_HOUR_MS)
      return recent ? 'fresh' : 'stale'
    },
    [ONE_HOUR_MS],
  )
  const [baseSearch, setBaseSearch] = useState('')
  const [showBaseList, setShowBaseList] = useState(false)
  // Robust resolver for compare row to handle potential id casing or address-based mismatches
  function resolveCompareRow(id: string | null): DetailModalRow | null {
    if (!id) return null
    // Primary: consumer-provided resolver
    const direct = getRowById(id)
    if (direct) return direct
    // Fallbacks within provided rows
    const lower = id.toLowerCase()
    const byId = allRows.find((r) => r.id === id) ?? null
    if (byId) return byId
    const byIdLower = allRows.find((r) => r.id?.toLowerCase?.() === lower) ?? null
    if (byIdLower) return byIdLower
    // Address-based fallbacks (pairAddress or tokenAddress sometimes used as ids)
    const byPair = allRows.find((r) => r.pairAddress?.toLowerCase?.() === lower) ?? null
    if (byPair) return byPair
    const byToken = allRows.find((r) => r.tokenAddress?.toLowerCase?.() === lower) ?? null
    if (byToken) return byToken
    return null
  }
  const compareRow = resolveCompareRow(compareId)
  useEffect(() => {
    /* removed setting latestCompareRow */
  }, [compareRow])

  // Seed initial compare snapshot when a compare token is chosen (id-based)
  useEffect(() => {
    if (!open || !compareRow?.id) return
    setHistory2((prev) => (prev.price.length > 0 ? prev : seedFromRow(compareRow)))
    // We intentionally seed only when compare id changes to avoid re-seeding on live updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, compareRow?.id])

  // Engage / update subscription lock when compare token changes
  useEffect(() => {
    if (!open || !primaryRow) return
    // Allow both pair-stats and high-frequency tick keys for base + compare so their charts update
    const basePairKey =
      primaryRow.pairAddress && primaryRow.tokenAddress
        ? buildPairKey(primaryRow.pairAddress, primaryRow.tokenAddress, primaryRow.chain)
        : null
    const baseTick = primaryRow.tokenAddress
      ? buildTickKey(primaryRow.tokenAddress, primaryRow.chain)
      : null
    const cmpPairKey =
      compareRow?.pairAddress && compareRow?.tokenAddress
        ? buildPairKey(compareRow.pairAddress, compareRow.tokenAddress, compareRow.chain)
        : null
    const cmpTick = compareRow?.tokenAddress
      ? buildTickKey(compareRow.tokenAddress, compareRow.chain)
      : null

    const allowed: string[] = []
    if (basePairKey) allowed.push(basePairKey)
    if (baseTick) allowed.push(baseTick)
    if (cmpPairKey) allowed.push(cmpPairKey)
    if (cmpTick) allowed.push(cmpTick)

    if (allowed.length > 0) {
      try {
        engageSubscriptionLock(allowed)
      } catch {
        /* no-op */
      }
    }
  }, [compareRow, open, primaryRow])
  // Subscribe to compare row updates (original detailed pair|token|chain listener removed; handled by unified tick/pair-stats listeners below)

  // Metric selection (shared across both charts)
  const [selectedMetric, setSelectedMetric] = useState<'price' | 'mcap'>('price')
  // Palettes
  const palette: Record<SeriesKey, string> = {
    price: '#22c55e',
    mcap: '#3b82f6',
    volume: '#a3a3a3',
    buys: '#8b5cf6',
    sells: '#ef4444',
    liquidity: '#f59e0b',
  }
  const palette2: Record<SeriesKey, string> = {
    price: '#10b981',
    mcap: '#2563eb',
    volume: '#737373',
    buys: '#6d28d9',
    sells: '#b91c1c',
    liquidity: '#d97706',
  }

  // Deterministic color generator for tokens: produce an HSL color based on the token symbol/name
  function tokenColorFromString(s: string | undefined | null) {
    try {
      const str = String(s ?? '').trim() || 'x'
      let h = 0
      for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) | 0
      }
      // map to 0..359
      const hue = Math.abs(h) % 360
      // use fixed saturation/lightness for good contrast
      return `hsl(${hue}deg 65% 52%)`
    } catch {
      return palette.price
    }
  }

  // token colors for legend and minisparks (derive from token symbol/name for visual differentiation)
  const tokenColorBase = tokenColorFromString(primaryRow?.tokenSymbol ?? primaryRow?.tokenName)
  const tokenColorCompare = tokenColorFromString(compareRow?.tokenSymbol ?? compareRow?.tokenName)
  // Filter compare options (extracted to pure util for testability)
  const filteredCompareOptions = computeFilteredCompareOptions<DetailModalRow>(
    ({
      open,
      allRows,
      currentRow: primaryRow ?? null,
      compareSearch,
      includeStale,
      includeDegraded,
    } as unknown) as any,
  )
  const filteredBaseOptions = computeFilteredCompareOptions<DetailModalRow>(
    ({
      open,
      allRows,
      currentRow: null,
      compareSearch: baseSearch,
      includeStale,
      includeDegraded,
    } as unknown) as any,
  )

  // Debug updates panel: capture raw JSON updates for this row
  const [updatesLog, setUpdatesLog] = useState<{ id: number; text: string }[]>([])
  const logRef = useRef<HTMLDivElement | null>(null)
  const logIdRef = useRef<number>(0)

  useEffect(() => {
    const pair = primaryRow?.pairAddress
    const token = primaryRow?.tokenAddress
    const chain = primaryRow?.chain
    if (!open || !pair || !token || !debugEnabled) return
    // Only clear the log when the tracked key changes (avoid clearing on every render)
    setUpdatesLog([])
    const key = buildPairKey(pair, token, chain)
    const off = onUpdate((e) => {
      try {
        if (e.key !== key) return
        const entry = JSON.stringify({ type: e.type, data: e.data })
        setUpdatesLog((prev) => {
          const next = [...prev, { id: ++logIdRef.current, text: entry }]
          if (next.length > 500) next.splice(0, next.length - 500)
          return next
        })
      } catch {
        /* no-op */
      }
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [
    open,
    primaryRow?.id,
    primaryRow?.chain,
    primaryRow?.pairAddress,
    primaryRow?.tokenAddress,
    debugEnabled,
  ])

  useEffect(() => {
    try {
      const el = logRef.current
      if (el) {
        el.scrollTop = el.scrollHeight
      }
    } catch {
      /* no-op */
    }
  }, [updatesLog])

  // Build per-series relative scaling spark paths
  const buildPath = useCallback(function buildPath(vals: number[], width = 600, height = 120) {
    const pad = 4
    const w = width
    const h = height
    const n = vals.length
    if (n === 0) return ''
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const range = Math.max(1e-6, max - min)
    // Special-case a single point to draw a visible flat line across the chart
    if (n === 1) {
      const y = pad + (h - pad * 2) * (1 - (vals[0] - min) / range)
      const x1 = pad
      const x2 = w - pad
      return `M ${x1},${y} L ${x2},${y}`
    }
    const xStep = (w - pad * 2) / (n - 1)
    const pts: string[] = []
    for (let i = 0; i < n; i++) {
      const x = pad + i * xStep
      const y = pad + (h - pad * 2) * (1 - (vals[i] - min) / range)
      pts.push(String(x) + ',' + String(y))
    }
    return pts.length > 0 ? 'M ' + pts.join(' L ') : ''
  }, [])

  // Inline dual-series micro spark for differential (Volume / Buys / Sells)
  function miniSpark(
    a: number[] = [],
    b: number[] = [],
    colorA: string,
    colorB: string,
    widthParam: number | 'fill' = 56,
    height = 20,
  ) {
    const pad = 2
    // Use a logical internal width for point calculations when using 'fill'
    const logicalWidth = widthParam === 'fill' ? 200 : widthParam
    const widthAttr = widthParam === 'fill' ? '100%' : String(widthParam)
    const len = Math.max(a.length, b.length)
    if (!len) return <span style={{ width: widthAttr, height }} />
    const merged: number[] = []
    for (let i = 0; i < len; i++) {
      if (i < a.length) merged.push(a[i])
      if (i < b.length) merged.push(b[i])
    }
    const max = Math.max(...merged, 1e-6)
    const min = Math.min(...merged)
    const range = Math.max(1e-6, max - min)
    const xStep = len > 1 ? (logicalWidth - pad * 2) / (len - 1) : 0
    const toPts = (vals: number[]) => {
      if (!vals.length) return [] as { x: number; y: number }[]
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i < len; i++) {
        const v = i < vals.length ? vals[i] : vals[vals.length - 1]
        const x = pad + i * xStep
        const y = pad + (height - pad * 2) * (1 - (v - min) / range)
        pts.push({ x, y })
      }
      return pts
    }
    const ptsA = toPts(a)
    const ptsB = toPts(b)
    const dA = ptsA.length ? 'M ' + ptsA.map((p) => `${p.x},${p.y}`).join(' L ') : ''
    const dB = ptsB.length ? 'M ' + ptsB.map((p) => `${p.x},${p.y}`).join(' L ') : ''
    const strokeA = 1.5
    const strokeB = 1.25
    const rA = strokeA // diameter = 2x line height → r = stroke
    const rB = strokeB
    return (
      <svg
        width={widthAttr}
        height={height}
        viewBox={`0 0 ${logicalWidth} ${height}`}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block' }}
      >
        <polyline
          points={`${pad},${height - pad} ${logicalWidth - pad},${height - pad}`}
          stroke="#374151"
          strokeWidth={1}
          fill="none"
        />
        {dB && <path d={dB} stroke={colorB} strokeWidth={strokeB} fill="none" opacity={0.85} />}
        {dA && <path d={dA} stroke={colorA} strokeWidth={strokeA} fill="none" />}
        {/* Emphasize points with dots on both series */}
        {ptsB.length > 0 && (
          <g opacity={0.85}>
            {ptsB.map((p) => (
              <circle key={`b-${p.x}-${p.y}`} cx={p.x} cy={p.y} r={rB} fill={colorB} />
            ))}
          </g>
        )}
        {ptsA.length > 0 && (
          <g>
            {ptsA.map((p) => (
              <circle key={`a-${p.x}-${p.y}`} cx={p.x} cy={p.y} r={rA} fill={colorA} />
            ))}
          </g>
        )}
      </svg>
    )
  }

  // Focus metric order (for differential stats)
  const focusOrderBase: SeriesKey[] =
    selectedMetric === 'price' ? ['price', 'mcap', 'liquidity'] : ['mcap', 'price', 'liquidity']
  const focusOrderCompare: SeriesKey[] = focusOrderBase

  // Differential stats (only for metrics in focusOrderBase)
  const diffs = (() => {
    if (!compareRow) return null
    const make = (k: SeriesKey) => {
      const aVals = history[k]
      const bVals = history2[k]
      const a = aVals[aVals.length - 1]
      const b = bVals[bVals.length - 1]
      if (a == null || b == null)
        return { k, a: undefined, b: undefined, delta: undefined, pct: undefined, ratio: undefined }
      const delta = a - b
      const pct = b !== 0 ? (delta / b) * 100 : undefined
      const ratio = b !== 0 ? a / b : undefined
      return { k, a, b, delta, pct, ratio }
    }
    return focusOrderBase.map(make)
  })()

  // Build derived subscription keys
  const basePairStatsKey =
    primaryRow?.pairAddress && primaryRow.tokenAddress
      ? buildPairKey(primaryRow.pairAddress, primaryRow.tokenAddress, primaryRow.chain)
      : null
  const baseTickKey = primaryRow?.tokenAddress
    ? buildTickKey(primaryRow.tokenAddress, primaryRow.chain)
    : null
  const comparePairStatsKey =
    compareRow?.pairAddress && compareRow.tokenAddress
      ? buildPairKey(compareRow.pairAddress, compareRow.tokenAddress, compareRow.chain)
      : null
  const compareTickKey = compareRow?.tokenAddress
    ? buildTickKey(compareRow.tokenAddress, compareRow.chain)
    : null

  // Generic series helpers
  const appendSnapshot = useCallback(
    (prev: Record<SeriesKey, number[]>, latest: DetailModalRow): Record<SeriesKey, number[]> => {
      return {
        price: [...prev.price, latest.priceUsd].slice(-300),
        mcap: [...prev.mcap, latest.mcap].slice(-300),
        volume: [...prev.volume, latest.volumeUsd].slice(-300),
        buys: [...prev.buys, latest.transactions.buys].slice(-300),
        sells: [...prev.sells, latest.transactions.sells].slice(-300),
        liquidity: [...prev.liquidity, latest.liquidity.current].slice(-300),
      }
    },
    [],
  )
  const seedFromRow = useCallback((latest: DetailModalRow): Record<SeriesKey, number[]> => {
    const anyLatest = latest as unknown as {
      history?: {
        price?: number[]
        mcap?: number[]
        volume?: number[]
        buys?: number[]
        sells?: number[]
        liquidity?: number[]
      }
    }
    const ensureTwo = (arr: number[] | undefined, fallback: number): number[] => {
      const a = Array.isArray(arr) ? [...arr] : []
      if (a.length >= 2) return a
      if (a.length === 1) return [a[0], a[0]]
      return [fallback, fallback]
    }
    const h = anyLatest.history
    if (h && (Array.isArray(h.price) || Array.isArray(h.mcap))) {
      return {
        price: ensureTwo(h.price, latest.priceUsd),
        mcap: ensureTwo(h.mcap, latest.mcap),
        volume: ensureTwo(h.volume, latest.volumeUsd),
        buys: ensureTwo(h.buys, latest.transactions.buys),
        sells: ensureTwo(h.sells, latest.transactions.sells),
        liquidity: ensureTwo(h.liquidity, latest.liquidity.current),
      }
    }
    return {
      price: [latest.priceUsd, latest.priceUsd],
      mcap: [latest.mcap, latest.mcap],
      volume: [latest.volumeUsd, latest.volumeUsd],
      buys: [latest.transactions.buys, latest.transactions.buys],
      sells: [latest.transactions.sells, latest.transactions.sells],
      liquidity: [latest.liquidity.current, latest.liquidity.current],
    }
  }, [])

  // Reset compare history when switching compare token
  const prevCompareIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open) return
    const cid = compareRow?.id ?? null
    if (cid && cid !== prevCompareIdRef.current) {
      setHistory2({ price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] })
    }
    prevCompareIdRef.current = cid
  }, [open, compareRow?.id])

  // Subscribe to pair-stats key for base (less frequent, structural stats)
  useEffect(() => {
    if (!open || !basePairStatsKey) return
    const off = onUpdate((e) => {
      if (e.key !== basePairStatsKey) return
      try {
        const id = row?.id
        const latest = currentRow ?? (id ? getRowById(id) : undefined)
        if (!latest) return
        setHistory((prev) => appendSnapshot(prev, latest))
      } catch {
        /* no-op */
      }
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [open, basePairStatsKey, currentRow, getRowById, row, row?.id, appendSnapshot])

  // Subscribe to tick key for base (high frequency)
  useEffect(() => {
    if (!open || !baseTickKey) return
    const off = onUpdate((e) => {
      if (e.key !== baseTickKey) return
      try {
        const id = row?.id
        const latest = currentRow ?? (id ? getRowById(id) : undefined)
        if (!latest) return
        setHistory((prev) => appendSnapshot(prev, latest))
      } catch {
        /* no-op */
      }
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [open, baseTickKey, currentRow, getRowById, row, row?.id, appendSnapshot])

  // Hook-driven debounced subscription for compare token
  const minimalAllRows = useMemo(
    () =>
      allRows.map((r) => ({
        id: r.id,
        pairAddress: r.pairAddress,
        tokenAddress: r.tokenAddress,
        chain: r.chain,
      })),
    [allRows],
  )
  const applyCompareSnapshotCb = useCallback(
    (id: string) => {
      const latest = getRowById(id)
      if (latest) setHistory2((prev) => appendSnapshot(prev, latest))
    },
    [getRowById, appendSnapshot],
  )
  const getRowByIdCb = useCallback((id: string) => getRowById(id), [getRowById])

  const {
    isSubscribing: compareIsSubscribing,
    canLiveStream: compareCanLive,
    lastUpdateAt,
    revertToLastLive,
  } = useCompareSubscription({
    open,
    compareRow: compareRow
      ? {
          id: compareRow.id,
          pairAddress: compareRow.pairAddress,
          tokenAddress: compareRow.tokenAddress,
          chain: compareRow.chain,
        }
      : null,
    allRows: minimalAllRows,
    toChainId,
    applyCompareSnapshot: applyCompareSnapshotCb,
    getRowById: getRowByIdCb,
    hasSeedData: history2.price.length > 0,
    debounceMs: 300,
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: open ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        backdropFilter: 'blur(8px)',
        background: 'rgba(0,0,0,0.48)',
      }}
      onClick={(e) => {
        if (e.target === wrapperRef.current) onClose()
      }}
      ref={wrapperRef}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 40px)',
          border: '1px solid #374151',
          borderRadius: 8,
          background: 'rgba(17,24,39,0.8)',
          overflow: 'auto',
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>Details</div>
            {row?.tokenAddress && (
              <UpdateRate
                title="Live rate"
                filterKey={[baseTickKey, basePairStatsKey].filter((s): s is string => Boolean(s))}
              />
            )}
            {compareRow?.tokenAddress && (
              <UpdateRate
                title="Compare rate"
                filterKey={[compareTickKey, comparePairStatsKey].filter((s): s is string =>
                  Boolean(s),
                )}
              />
            )}
            {compareRow && (
              <button
                type="button"
                onClick={() => {
                  setReversed((r) => !r)
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid #4b5563',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: 'inherit',
                }}
                title="Swap display order"
              >
                Swap
              </button>
            )}
            {compareRow && compareIsSubscribing && compareCanLive && (
              <span
                style={{ fontSize: 11, background: '#374151', padding: '2px 6px', borderRadius: 4 }}
              >
                Subscribing…
              </span>
            )}
            {compareRow && !compareCanLive && (
              <span
                style={{ fontSize: 11, background: '#4b5563', padding: '2px 6px', borderRadius: 4 }}
                title="Missing pair/token addresses; cannot live stream."
              >
                No live stream
              </span>
            )}
            {compareRow && lastUpdateAt && compareCanLive && !compareIsSubscribing && (
              <span
                style={{ fontSize: 11, background: '#1f2937', padding: '2px 6px', borderRadius: 4 }}
                title={new Date(lastUpdateAt).toLocaleString()}
              >
                updated {Math.max(0, Math.round((Date.now() - lastUpdateAt) / 1000))}s ago
              </span>
            )}
            {(() => {
              const last = revertToLastLive()
              return compareRow && last && last !== compareRow.id ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompareId(last)
                  }}
                  style={{
                    fontSize: 11,
                    background: '#374151',
                    border: '1px solid #4b5563',
                    borderRadius: 4,
                    padding: '2px 6px',
                    cursor: 'pointer',
                  }}
                  title="Revert to last successfully streaming compare token"
                >
                  Revert
                </button>
              ) : null
            })()}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'inherit',
              border: '1px solid #4b5563',
              borderRadius: 4,
              padding: '4px 8px',
            }}
          >
            Close
          </button>
        </div>
        {/* Selectors */}
        {open && (
          <div
            style={{
              marginBottom: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            {/* Base selector */}
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: 12 }} className="muted">
                Base token
              </label>
              <br />
              <input
                type="text"
                value={baseSearch}
                placeholder={
                  primaryRow
                    ? `${primaryRow.tokenName}/${primaryRow.tokenSymbol}`
                    : 'Search token name or symbol'
                }
                onFocus={() => {
                  setShowBaseList(true)
                }}
                onChange={(e) => {
                  setBaseSearch(e.currentTarget.value)
                  setShowBaseList(true)
                }}
                style={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#e5e7eb',
                  minWidth: 220,
                }}
              />
              {primaryRow && (
                <button
                  type="button"
                  onClick={() => {
                    setBaseId(null)
                    setBaseSearch('')
                    setHistory({
                      price: [],
                      mcap: [],
                      volume: [],
                      buys: [],
                      sells: [],
                      liquidity: [],
                    })
                    setHistory2({
                      price: [],
                      mcap: [],
                      volume: [],
                      buys: [],
                      sells: [],
                      liquidity: [],
                    })
                  }}
                  style={{
                    marginLeft: 8,
                    background: 'transparent',
                    border: '1px solid #4b5563',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'inherit',
                  }}
                >
                  Clear
                </button>
              )}
              <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={includeStale}
                    onChange={(e) => {
                      setIncludeStale(e.currentTarget.checked)
                    }}
                  />{' '}
                  Include stale
                </label>
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={includeDegraded}
                    onChange={(e) => {
                      setIncludeDegraded(e.currentTarget.checked)
                    }}
                  />{' '}
                  Include degraded
                </label>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  <span style={{ color: 'var(--accent-up)' }}>Fresh</span> •{' '}
                  <span style={{ color: '#e5e7eb' }}>Stale</span> •{' '}
                  <span style={{ color: 'var(--accent-down)' }}>Degraded</span>
                </span>
              </div>
              {showBaseList && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 10000,
                    background: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    width: 360,
                    maxHeight: 260,
                    overflow: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  }}
                >
                  {filteredBaseOptions.length === 0 && (
                    <div className="muted" style={{ padding: 6, fontSize: 12 }}>
                      No matches
                    </div>
                  )}
                  {filteredBaseOptions.map((opt) => (
                    <div
                      key={opt.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                      }}
                      onClick={() => {
                        setBaseId(opt.id)
                        setBaseSearch(`${opt.tokenName}/${opt.tokenSymbol}`)
                        setShowBaseList(false)
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        background: baseId === opt.id ? '#374151' : 'transparent',
                      }}
                    >
                      {(() => {
                        const f = freshnessOf(opt)
                        const color =
                          f === 'fresh'
                            ? 'var(--accent-up)'
                            : f === 'degraded'
                              ? 'var(--accent-down)'
                              : '#e5e7eb'
                        return (
                          <span style={{ color }}>
                            {opt.tokenName.toUpperCase()}/{opt.tokenSymbol} / {opt.chain}
                          </span>
                        )
                      })()}
                      <span className="muted">
                        {opt.pairAddress && opt.tokenAddress ? '•' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Compare selector */}
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: 12 }} className="muted">
                Compare with
              </label>
              <br />
              <input
                type="text"
                data-testid="compare-input"
                value={compareSearch}
                placeholder={
                  compareRow
                    ? `${compareRow.tokenName}/${compareRow.tokenSymbol}`
                    : 'Search token name or symbol'
                }
                onFocus={() => {
                  setShowCompareList(true)
                }}
                onChange={(e) => {
                  setCompareSearch(e.currentTarget.value)
                  setShowCompareList(true)
                }}
                style={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#e5e7eb',
                  minWidth: 220,
                }}
              />
              {compareRow && (
                <button
                  type="button"
                  onClick={() => {
                    setCompareId(null)
                    setCompareSearch('')
                    setHistory2({
                      price: [],
                      mcap: [],
                      volume: [],
                      buys: [],
                      sells: [],
                      liquidity: [],
                    })
                  }}
                  style={{
                    marginLeft: 8,
                    background: 'transparent',
                    border: '1px solid #4b5563',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: 'inherit',
                  }}
                >
                  Clear
                </button>
              )}
              <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={includeStale}
                    onChange={(e) => {
                      setIncludeStale(e.currentTarget.checked)
                    }}
                  />{' '}
                  Include stale
                </label>
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={includeDegraded}
                    onChange={(e) => {
                      setIncludeDegraded(e.currentTarget.checked)
                    }}
                  />{' '}
                  Include degraded
                </label>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  <span style={{ color: 'var(--accent-up)' }}>Fresh</span> •{' '}
                  <span style={{ color: '#e5e7eb' }}>Stale</span> •{' '}
                  <span style={{ color: 'var(--accent-down)' }}>Degraded</span>
                </span>
              </div>
              {showCompareList && (
                <div
                  data-testid="compare-options"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 10000,
                    background: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    width: 360,
                    maxHeight: 260,
                    overflow: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                  }}
                >
                  {filteredCompareOptions.length === 0 && (
                    <div className="muted" style={{ padding: 6, fontSize: 12 }}>
                      No matches
                    </div>
                  )}
                  {filteredCompareOptions.map((opt) => (
                    <div
                      key={opt.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                      }}
                      onClick={() => {
                        setCompareId(opt.id)
                        setCompareSearch(`${opt.tokenName}/${opt.tokenSymbol}`)
                        setShowCompareList(false)
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        background: compareId === opt.id ? '#374151' : 'transparent',
                      }}
                    >
                      {(() => {
                        const f = freshnessOf(opt)
                        const color =
                          f === 'fresh'
                            ? 'var(--accent-up)'
                            : f === 'degraded'
                              ? 'var(--accent-down)'
                              : '#e5e7eb'
                        return (
                          <span style={{ color }}>
                            {opt.tokenName.toUpperCase()}/{opt.tokenSymbol} / {opt.chain}
                          </span>
                        )
                      })()}
                      <span className="muted">
                        {opt.pairAddress && opt.tokenAddress ? '•' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* Chart sections */}
        {(() => {
          if (!primaryRow)
            return (
              <div className="muted" style={{ marginTop: 8, marginBottom: 8 }}>
                Select a base token to view details and charts.
              </div>
            )
          const baseSection = (
            <ChartSection
              key={primaryRow.id + '-base'}
              title={`${primaryRow.tokenName} (${primaryRow.tokenSymbol}) – ${primaryRow.chain}`}
              history={history as Record<string, number[]>}
              palette={palette as Record<string, string>}
              selectedMetric={selectedMetric}
              seriesKeys={seriesKeys}
              seriesLabels={seriesLabels as Record<string, string>}
              focusOrder={focusOrderBase}
              symbol={primaryRow.tokenSymbol}
              buildPath={buildPath}
              showMetricChooser
              onChangeMetric={(m) => {
                setSelectedMetric(m as 'price' | 'mcap')
              }}
              metricOptions={[
                { key: 'price', label: 'Price' },
                { key: 'mcap', label: 'Market Cap' },
              ]}
              emptyMessage="Collecting base data…"
            />
          )
          const compareSection = compareRow ? (
            <ChartSection
              key={compareRow.id + '-compare'}
              title={`${compareRow.tokenName} (${compareRow.tokenSymbol}) – ${compareRow.chain}${compareIsSubscribing && compareCanLive ? ' (Subscribing…)' : ''}${!compareCanLive ? ' (No live stream)' : ''}`}
              history={history2 as Record<string, number[]>}
              palette={palette2 as Record<string, string>}
              selectedMetric={selectedMetric}
              seriesKeys={seriesKeys}
              seriesLabels={seriesLabels as Record<string, string>}
              focusOrder={focusOrderCompare}
              symbol={compareRow.tokenSymbol}
              buildPath={buildPath}
              emptyMessage={
                !compareCanLive
                  ? 'No live data (missing pair/token addresses)'
                  : compareIsSubscribing
                    ? 'Subscribing…'
                    : 'Collecting compare data…'
              }
            />
          ) : null

          // Determine render order ensuring base always appears when no compare
          const first = reversed && compareRow ? compareSection : baseSection
          const second = compareRow ? (reversed ? baseSection : compareSection) : null

          return (
            <div>
              {first}
              {compareRow && diffs && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '8px 12px',
                    background: 'rgba(31,41,55,0.6)',
                    border: '1px solid #374151',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    Differential (Base vs Compare)
                  </div>
                  {/* Two-column layout: left=vertical text (Price/Mcap/Liquidity), right=three responsive mini-sparks */}
                  <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {/* Left column: Price / Market Cap / Liquidity vertical stack */}
                    <div style={{ minWidth: 240, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {['price', 'mcap', 'liquidity'].map((key) => {
                        const d = (diffs as any).find((x: any) => x.k === key)
                        return (
                          <div key={key} style={{ minWidth: 160 }}>
                            <div style={{ color: palette[key as SeriesKey], fontWeight: 600 }}>
                              {seriesLabels[key as SeriesKey]}
                            </div>
                            <div style={{ fontSize: 12 }}>
                              {(() => {
                                if (!d || d.a == null || d.b == null) return '—'
                                const isCurrency = key === 'price' || key === 'mcap' || key === 'liquidity'
                                const prefixSymbol = isCurrency ? '$' : ''
                                const delta = d.delta ?? 0
                                const pct = d.pct
                                const ratio = d.ratio
                                return (
                                  <span>
                                    <span>
                                      <NumberCell value={d.a} prefix={prefixSymbol} /> vs{' '}
                                      <NumberCell value={d.b} prefix={prefixSymbol} /> (
                                    </span>
                                    <NumberCell value={delta} noFade prefix={delta >= 0 ? '+' : ''} />
                                    {pct != null && (
                                      <>
                                        <span>, </span>
                                        <NumberCell
                                          value={pct}
                                          noFade
                                          prefix={pct >= 0 ? '+' : ''}
                                          suffix="%"
                                        />
                                      </>
                                    )}
                                    {ratio != null && (
                                      <>
                                        <span> ratio {ratio.toFixed(3)}</span>
                                      </>
                                    )}
                                    <span>)</span>
                                  </span>
                                )
                              })()}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Right column: responsive mini-sparks with legend */}
                    <div style={{ flex: 1, minWidth: 320 }}>
                      {/* Legend showing colored lines for base/compare token names */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {/* tokenColorBase: solid colored bar to indicate Base token color */}
                              <span style={{ display: 'inline-block', width: 28, height: 8, background: tokenColorBase, borderRadius: 3 }} />
                              <span style={{ fontSize: 12 }}>{primaryRow?.tokenName ?? 'Base'}</span>
                            </div>
                            {/* tokenColorCompare: solid colored bar to indicate Compare token color */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ display: 'inline-block', width: 28, height: 8, background: tokenColorCompare, borderRadius: 3 }} />
                              <span style={{ fontSize: 12 }}>{compareRow?.tokenName ?? 'Compare'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Three minisparks horizontally, each fills available width */}
                      <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ width: '100%' }}>
                            <div style={{ marginTop: 6 }}>
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Volume&nbsp;</span>
                              <span>&nbsp;Base:&nbsp;</span><NumberCell value={history.volume.at(-1) ?? '—'} prefix="$" />
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>&mdash;</span>
                              <span>&nbsp;Compare:&nbsp;</span><NumberCell value={history2.volume.at(-1) ?? '—'} prefix="$" />
                            </div>
                          </div>
                          <div style={{ width: '100%' }}>
                            {miniSpark(history.volume, history2.volume, tokenColorBase, tokenColorCompare, 'fill', 40)}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ width: '100%' }}>
                            <div style={{ marginTop: 6 }}>
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Buys&nbsp;</span>
                              <span>&nbsp;Base:&nbsp;</span><NumberCell value={history.buys.at(-1) ?? '—'} prefix="" />
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>&mdash;</span>
                              <span>&nbsp;Compare:&nbsp;</span><NumberCell value={history2.buys.at(-1) ?? '—'} prefix="" />
                            </div>
                          </div>
                          <div style={{ width: '100%' }}>
                            {miniSpark(history.buys, history2.buys, tokenColorBase, tokenColorCompare, 'fill', 40)}
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ width: '100%' }}>
                            <div style={{ marginTop: 6 }}>
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>Sells&nbsp;</span>
                              <span>&nbsp;Base:&nbsp;</span><NumberCell value={history.sells.at(-1) ?? '—'} prefix="" />
                              <span style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>&mdash;</span>
                              <span>&nbsp;Compare:&nbsp;</span><NumberCell value={history2.sells.at(-1) ?? '—'} prefix="" />
                            </div>
                          </div>
                         <div style={{ width: '100%' }}>
                            {miniSpark(history.sells, history2.sells, tokenColorBase, tokenColorCompare, 'fill', 40)}
                          </div>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {second}
            </div>
          )
        })()}
        {/* Debug panel at the bottom */}
        {debugEnabled && row?.pairAddress && row.tokenAddress && (
          <div style={{ marginTop: 12, borderTop: '1px solid #374151', paddingTop: 12 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Debug updates (raw JSON)
            </div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Base tick key: {baseTickKey ?? '—'} | Base stats key: {basePairStatsKey ?? '—'} |
              Price points: {history.price.length}
              {compareRow && (
                <>
                  <br />
                  Compare tick key: {compareTickKey ?? '—'} | Compare stats key:{' '}
                  {comparePairStatsKey ?? '—'} | Price points: {history2.price.length}
                </>
              )}
            </div>
            <div
              ref={logRef}
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 11,
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid #374151',
                borderRadius: 6,
                padding: 8,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre',
                lineHeight: 1.4,
              }}
            >
              {updatesLog.length === 0 ? (
                <div className="muted">No updates yet…</div>
              ) : (
                updatesLog.map((item) => <div key={item.id}>{item.text}</div>)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
