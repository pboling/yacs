/*
  App.tsx
  High-level container rendering two token tables (Trending, New) and wiring:
  - Initial REST fetches via src/scanner.client.js
  - WebSocket subscriptions via src/ws.mapper.js and src/ws.subs.js
  - State management via a pure reducer in src/tokens.reducer.js

  Notes for maintainers:
  - This file is TypeScript-first but interoperates with JS modules using
    explicit type casts to satisfy strict settings. Keep casts narrow and local.
  - WebSocket logic includes a simple multi-endpoint fallback (dev proxy, env override, public).
  - Sorting is performed client-side; server-side filters are configured per table.
*/
import { useEffect, useMemo, useReducer, useState, useRef } from 'react'
import './App.css'
import {
  NEW_TOKENS_FILTERS,
  TRENDING_TOKENS_FILTERS,
  type GetScannerResultParams,
  type ScannerResult,
  chainIdToName,
} from './test-task-types'
import { initialState, tokensReducer } from './tokens.reducer.js'
import { fetchScanner } from './scanner.client.js'
import { buildScannerSubscription, buildPairSubscription, buildPairStatsSubscription, mapIncomingMessageToAction } from './ws.mapper.js'
import { computePairPayloads } from './ws.subs.js'

/**
 * Format a creation timestamp into a short relative age (e.g., 12m, 3h, 2d).
 * Pure helper used by table rows; safe for frequent calls.
 */
function formatAge(ts: Date) {
  const now = Date.now()
  const diff = Math.max(0, now - ts.getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return String(mins) + 'm'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return String(hrs) + 'h'
  const days = Math.floor(hrs / 24)
  return String(days) + 'd'
}

// Minimal row type for table consumption
interface TokenRow {
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
}

type SortKey = 'tokenName' | 'exchange' | 'priceUsd' | 'mcap' | 'volumeUsd' | 'age' | 'tx' | 'liquidity'

// Local state shape matching tokens.reducer.js output
interface TokensMeta { totalSupply: number; token0Address?: string }
interface State {
  byId: Record<string, TokenRow>
  meta: Record<string, TokensMeta>
  pages: Partial<Record<number, string[]>>
  filters: { excludeHoneypots: boolean }
}

// Local action types matching tokens.reducer.js
interface ScannerPairsAction { type: 'scanner/pairs'; payload: { page: number; scannerPairs: unknown[] } }
interface TickAction { type: 'pair/tick'; payload: { pair: { pair: string; token: string; chain: string }; swaps: unknown[] } }
interface PairStatsAction { type: 'pair/stats'; payload: { data: unknown } }
interface FiltersAction { type: 'filters/set'; payload: { excludeHoneypots?: boolean } }

type Action = ScannerPairsAction | TickAction | PairStatsAction | FiltersAction

/**
 * Table component
 * Renders a sortable token table with loading/error/empty states.
 * Props are intentionally minimal to keep rendering logic decoupled from data shaping.
 */
function Table({ title, rows, loading, error, onSort, sortKey, sortDir }: {
  title: string
  rows: TokenRow[]
  loading: boolean
  error: string | null
  onSort: (k: SortKey) => void
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
}) {
  return (
    <section>
      <h2>{title}</h2>
      {loading && <div className="status">Loading…</div>}
      {error && <div className="status error">{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="status">No data</div>}
      {!loading && !error && rows.length > 0 && (
        <div className="table-wrap">
          <table className="tokens">
            <thead>
              <tr>
                <th onClick={() => { onSort('tokenName') }} aria-sort={sortKey === 'tokenName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Token</th>
                <th onClick={() => { onSort('exchange') }} aria-sort={sortKey === 'exchange' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Exchange</th>
                <th onClick={() => { onSort('priceUsd') }} aria-sort={sortKey === 'priceUsd' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Price</th>
                <th onClick={() => { onSort('mcap') }} aria-sort={sortKey === 'mcap' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>MCap</th>
                <th onClick={() => { onSort('volumeUsd') }} aria-sort={sortKey === 'volumeUsd' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Volume</th>
                <th>Chg (5m/1h/6h/24h)</th>
                <th onClick={() => { onSort('age') }} aria-sort={sortKey === 'age' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Age</th>
                <th onClick={() => { onSort('tx') }} aria-sort={sortKey === 'tx' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Buys/Sells</th>
                <th onClick={() => { onSort('liquidity') }} aria-sort={sortKey === 'liquidity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div>
                      <strong>{t.tokenName}</strong> <span>({t.tokenSymbol})</span>
                    </div>
                    <div className="muted">{t.chain}</div>
                  </td>
                  <td>{t.exchange}</td>
                  <td>${t.priceUsd.toFixed(6)}</td>
                  <td>${Math.round(t.mcap).toLocaleString()}</td>
                  <td>${Math.round(t.volumeUsd).toLocaleString()}</td>
                  <td>
                    <span className={t.priceChangePcs['5m'] >= 0 ? 'up' : 'down'}>{t.priceChangePcs['5m']}%</span>{' / '}
                    <span className={t.priceChangePcs['1h'] >= 0 ? 'up' : 'down'}>{t.priceChangePcs['1h']}%</span>{' / '}
                    <span className={t.priceChangePcs['6h'] >= 0 ? 'up' : 'down'}>{t.priceChangePcs['6h']}%</span>{' / '}
                    <span className={t.priceChangePcs['24h'] >= 0 ? 'up' : 'down'}>{t.priceChangePcs['24h']}%</span>
                  </td>
                  <td>{formatAge(t.tokenCreatedTimestamp)}</td>
                  <td>
                    {t.transactions.buys}/{t.transactions.sells}
                  </td>
                  <td>${Math.round(t.liquidity.current).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function App() {
  // Memoize filters to satisfy exhaustive-deps
  const trendingFilters: GetScannerResultParams = useMemo(() => TRENDING_TOKENS_FILTERS, [])
  const newFilters: GetScannerResultParams = useMemo(() => NEW_TOKENS_FILTERS, [])

  // Typed aliases for JS functions to satisfy strict lint rules
  const fetchScannerTyped = fetchScanner as unknown as (params: GetScannerResultParams) => Promise<{ raw: { page?: number | null; scannerPairs?: ScannerResult[] | null } }>
  const buildScannerSubscriptionSafe = buildScannerSubscription as unknown as (params: GetScannerResultParams) => { event: 'scanner-filter'; data: GetScannerResultParams }
  const buildPairSubscriptionSafe = buildPairSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair'; data: { pair: string; token: string; chain: string } }
  const buildPairStatsSubscriptionSafe = buildPairStatsSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair-stats'; data: { pair: string; token: string; chain: string } }
  const mapIncomingMessageToActionSafe = mapIncomingMessageToAction as unknown as (msg: unknown) => (ScannerPairsAction | TickAction | PairStatsAction | null)
  const computePairPayloadsSafe = computePairPayloads as unknown as (items: ScannerResult[] | unknown[]) => { pair: string; token: string; chain: string }[]

  // minimal local sort state per table
  const [trendSort, setTrendSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'volumeUsd', dir: 'desc' })
  const [newSort, setNewSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'age', dir: 'desc' })

  const [state, dispatch] = useReducer(tokensReducer as unknown as (state: State | undefined, action: Action) => State, initialState as unknown as State)
  const d: React.Dispatch<Action> = dispatch as unknown as React.Dispatch<Action>
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [errorA, setErrorA] = useState<string | null>(null)
  const [errorB, setErrorB] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Fetch page 1 for both tables on mount
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingA(true)
      setErrorA(null)
      try {
        const res = await fetchScannerTyped({ ...trendingFilters, page: 1 })
        const raw = res.raw
        if (!cancelled) {
          d({ type: 'scanner/pairs', payload: { page: raw.page ?? 1, scannerPairs: raw.scannerPairs ?? [] } })
          // After initial REST load, subscribe to pair updates if WS is connected
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && Array.isArray(raw.scannerPairs)) {
            const payloads = computePairPayloadsSafe(raw.scannerPairs)
            for (const p of payloads) {
              wsRef.current.send(JSON.stringify(buildPairSubscriptionSafe(p)))
              wsRef.current.send(JSON.stringify(buildPairStatsSubscriptionSafe(p)))
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load trending'
        if (!cancelled) setErrorA(msg)
      } finally {
        if (!cancelled) setLoadingA(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [trendingFilters, d, fetchScannerTyped, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, computePairPayloadsSafe])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingB(true)
      setErrorB(null)
      try {
        const res = await fetchScannerTyped({ ...newFilters, page: 1 })
        const raw = res.raw
        if (!cancelled) {
          d({ type: 'scanner/pairs', payload: { page: (raw.page ?? 1) * 1000, scannerPairs: raw.scannerPairs ?? [] } })
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && Array.isArray(raw.scannerPairs)) {
            const payloads = computePairPayloadsSafe(raw.scannerPairs)
            for (const p of payloads) {
              wsRef.current.send(JSON.stringify(buildPairSubscriptionSafe(p)))
              wsRef.current.send(JSON.stringify(buildPairStatsSubscriptionSafe(p)))
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load new tokens'
        if (!cancelled) setErrorB(msg)
      } finally {
        if (!cancelled) setLoadingB(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [newFilters, d, fetchScannerTyped, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, computePairPayloadsSafe])

  // derive rows for each table from pages (use a local typed alias to satisfy strict linting)
  const st = state as unknown as State
  const trendingIds = st.pages[1] ?? []
  const newIds = st.pages[1000] ?? [] // use a separate page bucket for the second table
  let trendingRows: TokenRow[] = trendingIds
    .map((id: string) => st.byId[id])
    .filter((t): t is TokenRow => Boolean(t))
  let newRows: TokenRow[] = newIds
    .map((id: string) => st.byId[id])
    .filter((t): t is TokenRow => Boolean(t))

  const sorter = (key: SortKey, dir: 'asc' | 'desc') => (a: TokenRow, b: TokenRow) => {
    const getVal = (t: TokenRow): number | string => {
      switch (key) {
        case 'age': return t.tokenCreatedTimestamp.getTime()
        case 'tx': return (t.transactions.buys + t.transactions.sells)
        case 'liquidity': return t.liquidity.current
        case 'tokenName': return t.tokenName.toLowerCase()
        case 'exchange': return t.exchange.toLowerCase()
        case 'priceUsd': return t.priceUsd
        case 'mcap': return t.mcap
        case 'volumeUsd': return t.volumeUsd
        default: return 0
      }
    }
    const va = getVal(a)
    const vb = getVal(b)
    let cmp = 0
    if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb)
    else cmp = (va as number) < (vb as number) ? -1 : (va as number) > (vb as number) ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  }

  trendingRows = [...trendingRows].sort(sorter(trendSort.key, trendSort.dir))
  newRows = [...newRows].sort(sorter(newSort.key, newSort.dir))

  const onTrendSort = (k: SortKey) => { setTrendSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' })) }
  const onNewSort = (k: SortKey) => { setNewSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' })) }

  // WebSocket connection with fallback and subscriptions
  useEffect(() => {
    let cancelled = false
    let opened = false
    let attempt = 0
    let currentWs: WebSocket | null = null
    let openTimeout: ReturnType<typeof setTimeout> | null = null

    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
    const devUrl = proto + location.host + '/ws'
    const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
    // Allow override via env (useful for debugging)
    const envUrl: string | null = typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
    const urls: string[] = import.meta.env.DEV ? [envUrl, devUrl, prodUrl].filter(Boolean) as string[] : [envUrl, prodUrl].filter(Boolean) as string[]

    function connectNext() {
      if (cancelled) return
      const url = urls[attempt++]
      if (!url) {
        // no more options; give up silently
        return
      }
      try {
        const ws = new WebSocket(url)
        currentWs = ws
        wsRef.current = ws

        // If connection does not open within a short window, try next URL
        if (openTimeout) clearTimeout(openTimeout)
        openTimeout = setTimeout(() => {
          if (!opened && ws.readyState !== WebSocket.OPEN) {
            try { ws.close() } catch { /* ignore */ }
            connectNext()
          }
        }, 1500)

        ws.onopen = () => {
          opened = true
          if (openTimeout) { clearTimeout(openTimeout); openTimeout = null }
          // subscribe to scanner filters for both tables
          ws.send(JSON.stringify(buildScannerSubscriptionSafe(trendingFilters)))
          ws.send(JSON.stringify(buildScannerSubscriptionSafe(newFilters)))
        }
        ws.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as unknown
            // dispatch mapped actions
            const action = mapIncomingMessageToActionSafe(parsed)
            if (action) d(action)
            // after receiving scanner-pairs, subscribe to pair & pair-stats for the included tokens
            if (
              parsed &&
              typeof parsed === 'object' &&
              (parsed as { event?: unknown }).event === 'scanner-pairs' &&
              Array.isArray((parsed as { data?: { scannerPairs?: unknown[] } }).data?.scannerPairs)
            ) {
              const payloads = computePairPayloadsSafe((parsed as { data: { scannerPairs: unknown[] } }).data.scannerPairs)
              for (const p of payloads) {
                const subPair = JSON.stringify(buildPairSubscriptionSafe(p))
                const subStats = JSON.stringify(buildPairStatsSubscriptionSafe(p))
                ws.send(subPair)
                ws.send(subStats)
              }
            }
          } catch {
            /* ignore malformed messages */
          }
        }
        ws.onerror = () => {
          // If not opened yet, try next endpoint
          if (!opened) {
            try { ws.close() } catch { /* ignore */ }
            connectNext()
          }
        }
        ws.onclose = () => {
          // If closed before opening, try next; otherwise keep closed (no auto-reconnect for now)
          if (!opened) {
            connectNext()
          }
        }
      } catch {
        // If construction fails, move to next
        connectNext()
      }
    }

    connectNext()

    return () => {
      cancelled = true
      opened = false
      if (openTimeout) { clearTimeout(openTimeout); openTimeout = null }
      // Avoid closing a CONNECTING socket to prevent browser error: "WebSocket is closed before the connection is established."
      try {
        if (currentWs) {
          if (currentWs.readyState === WebSocket.CONNECTING) {
            const wsToClose = currentWs
            // Defer close until it opens or times out
            const closeIfOpen = () => {
              try { if (wsToClose.readyState === WebSocket.OPEN) wsToClose.close() } catch { void 0 }
            }
            wsToClose.addEventListener('open', closeIfOpen, { once: true })
            // Also set a short timeout to avoid lingering sockets
            setTimeout(() => {
              try { if (wsToClose.readyState === WebSocket.CONNECTING) wsToClose.close() } catch { void 0 }
            }, 1000)
          } else {
            currentWs.close()
          }
        }
      } catch { /* ignore close errors */ }
      wsRef.current = null
    }
  }, [trendingFilters, newFilters, d, buildScannerSubscriptionSafe, mapIncomingMessageToActionSafe, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, computePairPayloadsSafe])

  // keep demo type usage to satisfy README guidance
  const demoMap = useMemo(() => {
    const example: ScannerResult = {
      age: new Date().toISOString(),
      bundlerHoldings: '0',
      callCount: 0,
      chainId: 1,
      contractRenounced: false,
      contractVerified: false,
      currentMcap: '0',
      devHoldings: '0',
      dexPaid: false,
      diff1H: '0',
      diff24H: '0',
      diff5M: '0',
      diff6H: '0',
      fdv: '0',
      first1H: '0',
      first24H: '0',
      first5M: '0',
      first6H: '0',
      initialMcap: '0',
      insiderHoldings: '0',
      insiders: 0,
      isFreezeAuthDisabled: false,
      isMintAuthDisabled: false,
      liquidity: '0',
      liquidityLocked: false,
      liquidityLockedAmount: '0',
      liquidityLockedRatio: '0',
      migratedFromVirtualRouter: null,
      virtualRouterType: null,
      pairAddress: '0x',
      pairMcapUsd: '0',
      pairMcapUsdInitial: '0',
      percentChangeInLiquidity: '0',
      percentChangeInMcap: '0',
      price: '0',
      reserves0: '0',
      reserves0Usd: '0',
      reserves1: '0',
      reserves1Usd: '0',
      routerAddress: '0x',
      sniperHoldings: '0',
      snipers: 0,
      token0Decimals: 18,
      token0Symbol: 'WETH',
      token1Address: '0x',
      token1Decimals: '18',
      token1Name: 'Token',
      token1Symbol: 'TKN',
      token1TotalSupplyFormatted: '0',
      top10Holdings: '0',
      volume: '0',
    }
    const chainName = chainIdToName(example.chainId)
    return { chainName }
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <h1>Dexcelerate Scanner</h1>
      <p className="muted">Demo chainIdToName: {demoMap.chainName}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Table
          title="Trending Tokens"
          rows={trendingRows}
          loading={loadingA}
          error={errorA}
          onSort={onTrendSort}
          sortKey={trendSort.key}
          sortDir={trendSort.dir}
        />
        <Table
          title="New Tokens"
          rows={newRows}
          loading={loadingB}
          error={errorB}
          onSort={onNewSort}
          sortKey={newSort.key}
          sortDir={newSort.dir}
        />
      </div>
    </div>
  )
}

export default App
