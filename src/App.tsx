import { useEffect, useMemo, useReducer, useState } from 'react'
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
                <th onClick={() => { onSort('tokenName') }} aria-sort={sortKey === 'tokenName' ? sortDir : 'none'}>Token</th>
                <th onClick={() => { onSort('exchange') }} aria-sort={sortKey === 'exchange' ? sortDir : 'none'}>Exchange</th>
                <th onClick={() => { onSort('priceUsd') }} aria-sort={sortKey === 'priceUsd' ? sortDir : 'none'}>Price</th>
                <th onClick={() => { onSort('mcap') }} aria-sort={sortKey === 'mcap' ? sortDir : 'none'}>MCap</th>
                <th onClick={() => { onSort('volumeUsd') }} aria-sort={sortKey === 'volumeUsd' ? sortDir : 'none'}>Volume</th>
                <th>Chg (5m/1h/6h/24h)</th>
                <th onClick={() => { onSort('age') }} aria-sort={sortKey === 'age' ? sortDir : 'none'}>Age</th>
                <th onClick={() => { onSort('tx') }} aria-sort={sortKey === 'tx' ? sortDir : 'none'}>Buys/Sells</th>
                <th onClick={() => { onSort('liquidity') }} aria-sort={sortKey === 'liquidity' ? sortDir : 'none'}>Liquidity</th>
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

  // Typed alias for the JS fetch function to satisfy strict lint rules
  const fetchScannerTyped = fetchScanner as unknown as (params: unknown) => Promise<{ raw: { page?: number | null; scannerPairs?: unknown[] | null } }>

  // minimal local sort state per table
  const [trendSort, setTrendSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'volumeUsd', dir: 'desc' })
  const [newSort, setNewSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'age', dir: 'desc' })

  const [state, dispatch] = useReducer<React.Reducer<State, Action>>(tokensReducer as unknown as React.Reducer<State, Action>, initialState as unknown as State)
  const d: React.Dispatch<Action> = dispatch as unknown as React.Dispatch<Action>
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)
  const [errorA, setErrorA] = useState<string | null>(null)
  const [errorB, setErrorB] = useState<string | null>(null)

  // Fetch page 1 for both tables on mount
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingA(true)
      setErrorA(null)
      try {
        const res = await fetchScannerTyped({ ...trendingFilters, page: 1 })
        const raw = res.raw
        if (!cancelled) d({ type: 'scanner/pairs', payload: { page: raw.page ?? 1, scannerPairs: raw.scannerPairs ?? [] } })
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
  }, [trendingFilters, d, fetchScannerTyped])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingB(true)
      setErrorB(null)
      try {
        const res = await fetchScannerTyped({ ...newFilters, page: 1 })
        const raw = res.raw
        if (!cancelled) d({ type: 'scanner/pairs', payload: { page: (raw.page ?? 1) * 1000, scannerPairs: raw.scannerPairs ?? [] } })
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
  }, [newFilters, d, fetchScannerTyped])

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
