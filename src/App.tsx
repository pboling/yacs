import { useEffect, useMemo, useReducer, useState } from 'react'
import './App.css'
import {
  NEW_TOKENS_FILTERS,
  TRENDING_TOKENS_FILTERS,
  type GetScannerResultParams,
  type ScannerResult,
  chainIdToName,
} from './test-task-types'
import { initialState, tokensReducer, actions } from './tokens.reducer.js'
import { fetchScanner } from './scanner.client.js'

function formatAge(ts: Date) {
  const now = Date.now()
  const diff = Math.max(0, now - ts.getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function Table({ title, rows, loading, error, onSort, sortKey, sortDir }: {
  title: string
  rows: any[]
  loading: boolean
  error: string | null
  onSort: (k: string) => void
  sortKey: string
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
                <th onClick={() => onSort('token')}>Token</th>
                <th onClick={() => onSort('exchange')}>Exchange</th>
                <th onClick={() => onSort('priceUsd')}>Price</th>
                <th onClick={() => onSort('mcap')}>MCap</th>
                <th onClick={() => onSort('volumeUsd')}>Volume</th>
                <th>Chg (5m/1h/6h/24h)</th>
                <th onClick={() => onSort('age')}>Age</th>
                <th onClick={() => onSort('tx')}>Buys/Sells</th>
                <th onClick={() => onSort('liquidity')}>Liquidity</th>
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
  const trendingFilters: GetScannerResultParams = TRENDING_TOKENS_FILTERS
  const newFilters: GetScannerResultParams = NEW_TOKENS_FILTERS

  // minimal local sort state per table
  const [trendSort, setTrendSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'volumeUsd', dir: 'desc' })
  const [newSort, setNewSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'age', dir: 'desc' })

  const [state, dispatch] = useReducer(tokensReducer, initialState)
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
        const { raw } = await fetchScanner({ ...trendingFilters, page: 1 })
        if (!cancelled) dispatch(actions.scannerPairs(raw.page ?? 1, raw.scannerPairs ?? []))
      } catch (e: any) {
        if (!cancelled) setErrorA(e?.message || 'Failed to load trending')
      } finally {
        if (!cancelled) setLoadingA(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoadingB(true)
      setErrorB(null)
      try {
        const { raw } = await fetchScanner({ ...newFilters, page: 1 })
        if (!cancelled) dispatch(actions.scannerPairs((raw.page ?? 1) * 1000, raw.scannerPairs ?? []))
      } catch (e: any) {
        if (!cancelled) setErrorB(e?.message || 'Failed to load new tokens')
      } finally {
        if (!cancelled) setLoadingB(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  // derive rows for each table from pages
  const trendingIds = state.pages[1] || []
  const newIds = state.pages[1000] || [] // use a separate page bucket for the second table
  let trendingRows = trendingIds.map((id: string) => state.byId[id]).filter(Boolean)
  let newRows = newIds.map((id: string) => state.byId[id]).filter(Boolean)

  const sorter = (key: string, dir: 'asc' | 'desc') => (a: any, b: any) => {
    const va = key === 'age' ? a.tokenCreatedTimestamp.getTime() : a[key]
    const vb = key === 'age' ? b.tokenCreatedTimestamp.getTime() : b[key]
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  }

  trendingRows = [...trendingRows].sort(sorter(trendSort.key, trendSort.dir))
  newRows = [...newRows].sort(sorter(newSort.key, newSort.dir))

  const onTrendSort = (k: string) => setTrendSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))
  const onNewSort = (k: string) => setNewSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))

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
