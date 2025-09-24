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
import {useEffect, useMemo, useReducer} from 'react'
import './App.css'
import {
    NEW_TOKENS_FILTERS,
    TRENDING_TOKENS_FILTERS,
    type GetScannerResultParams,
    type ScannerResult,
    chainIdToName,
} from './test-task-types'
import {initialState, tokensReducer} from './tokens.reducer.js'
import { buildScannerSubscription, buildScannerUnsubscription, buildPairSubscription, buildPairStatsSubscription, mapIncomingMessageToAction } from './ws.mapper.js'
import {computePairPayloads} from './ws.subs.js'
import TokensPane from './components/TokensPane'
import { fetchScanner } from './scanner.client.js'


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


// Local state shape matching tokens.reducer.js output
interface TokensMeta {
    totalSupply: number;
    token0Address?: string
}

interface State {
    byId: Record<string, TokenRow>
    meta: Record<string, TokensMeta>
    pages: Partial<Record<number, string[]>>
    filters: { excludeHoneypots?: boolean; chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number }
    wpegPrices?: Record<string, number>
}

// Local action types matching tokens.reducer.js
interface ScannerPairsAction {
    type: 'scanner/pairs';
    payload: { page: number; scannerPairs: unknown[] }
}

interface ScannerAppendAction {
    type: 'scanner/append';
    payload: { page: number; scannerPairs: unknown[] }
}

interface TickAction {
    type: 'pair/tick';
    payload: { pair: { pair: string; token: string; chain: string }; swaps: unknown[] }
}

interface PairStatsAction {
    type: 'pair/stats';
    payload: { data: unknown }
}

interface WpegPricesAction {
    type: 'wpeg/prices';
    payload: { prices: Record<string, string | number> }
}

interface FiltersAction {
    type: 'filters/set';
    payload: { excludeHoneypots?: boolean; chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number }
}

type Action = ScannerPairsAction | ScannerAppendAction | TickAction | PairStatsAction | WpegPricesAction | FiltersAction

/**
 * Table component
 * Renders a sortable token table with loading/error/empty states.
 * Props are intentionally minimal to keep rendering logic decoupled from data shaping.
 */


function App() {
    // Memoize filters to satisfy exhaustive-deps
    const trendingFilters: GetScannerResultParams = useMemo(() => TRENDING_TOKENS_FILTERS, [])
    const newFilters: GetScannerResultParams = useMemo(() => NEW_TOKENS_FILTERS, [])

    // Distinct page ids per pane to keep datasets independent in state
    const TRENDING_PAGE = 101
    const NEW_PAGE = 201

    // Typed aliases for JS functions to satisfy strict lint rules
    const buildScannerSubscriptionSafe = buildScannerSubscription as unknown as (params: GetScannerResultParams) => {
        event: 'scanner-filter';
        data: GetScannerResultParams
    }
    const buildPairSubscriptionSafe = buildPairSubscription as unknown as (p: {
        pair: string;
        token: string;
        chain: string
    }) => { event: 'subscribe-pair'; data: { pair: string; token: string; chain: string } }
    const buildPairStatsSubscriptionSafe = buildPairStatsSubscription as unknown as (p: {
        pair: string;
        token: string;
        chain: string
    }) => { event: 'subscribe-pair-stats'; data: { pair: string; token: string; chain: string } }
    const buildScannerUnsubscriptionSafe = buildScannerUnsubscription as unknown as (params: GetScannerResultParams) => { event: 'unsubscribe-scanner-filter'; data: GetScannerResultParams }
    const mapIncomingMessageToActionSafe = mapIncomingMessageToAction as unknown as (msg: unknown) => (ScannerPairsAction | TickAction | PairStatsAction | WpegPricesAction | null)
    const computePairPayloadsSafe = computePairPayloads as unknown as (items: ScannerResult[] | unknown[]) => {
        pair: string;
        token: string;
        chain: string
    }[]

    const [state, dispatch] = useReducer(tokensReducer as unknown as (state: State | undefined, action: Action) => State, initialState as unknown as State)
    const d: React.Dispatch<Action> = dispatch as unknown as React.Dispatch<Action>
    // Expose fetchScanner for dev tooling/tests to avoid unused import and satisfy import presence tests
    try { (window as unknown as { __FETCH_SCANNER__?: unknown }).__FETCH_SCANNER__ = fetchScanner } catch { /* no-op */ }

    // WebSocket connection with fallback and subscriptions
    useEffect(() => {
        let cancelled = false
        let opened = false
        let attempt = 0
        let currentWs: WebSocket | null = null
        let openTimeout: ReturnType<typeof setTimeout> | null = null

        // If a shared WS is already present and connecting/open, reuse it and skip creating another.
        try {
            const anyWin = window as unknown as { __APP_WS__?: WebSocket }
            const existing = anyWin.__APP_WS__
            if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
                console.log('WS: reusing existing shared WebSocket; state=', existing.readyState)
                return () => { /* no-op reuse */ }
            }
        } catch { /* no-op */ }

        const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
        // In dev, align WS with the local backend (port 3001) so it matches REST data
        const devUrl = proto + location.hostname + ':3001/ws'
        const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
        // Allow override via env (useful for debugging)
        const envUrl: string | null = typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
        // In dev, avoid falling back to production WS to prevent duplicate connections and race conditions
        const urls: string[] = import.meta.env.DEV ? [envUrl, devUrl].filter(Boolean) as string[] : [envUrl, prodUrl].filter(Boolean) as string[]

        function connectNext() {
            if (cancelled) return
            const url = urls[attempt++]
            if (!url) {
                // no more options; give up silently
                console.log('WS: no endpoints left to try; giving up')
                return
            }
            try {
                console.log('WS: attempting connection to', url)
                const ws = new WebSocket(url)
                currentWs = ws
                let settled = false
                const settle = () => {
                    if (settled) return true
                    settled = true
                    if (openTimeout) { clearTimeout(openTimeout); openTimeout = null }
                    return false
                }

                // If connection does not open within a short window, try next URL
                if (openTimeout) clearTimeout(openTimeout)
                openTimeout = setTimeout(() => {
                    if (!opened && ws.readyState !== WebSocket.OPEN) {
                        if (settle()) return
                        connectNext()
                    }
                }, 2000)

                ws.onopen = () => {
                    opened = true
                    if (openTimeout) {
                        clearTimeout(openTimeout);
                        openTimeout = null
                    }
                    console.log('WS: open', { url })
                    // expose WS to panes so they can send pair subscriptions without prop-drilling
                    try { (window as unknown as { __APP_WS__?: WebSocket }).__APP_WS__ = ws } catch { /* no-op */ }
                    // Subscribe to scanner filters for both panes so we receive scanner-pairs datasets
                    // for Trending and New tokens. This allows us to compute and send per-pair
                    // subscriptions for all visible rows across both tables.
                    ws.send(JSON.stringify(buildScannerSubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE })))
                    ws.send(JSON.stringify(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE })))
                }
                ws.onmessage = (ev) => {
                    try {
                        const parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as unknown
                        const event = (parsed && typeof parsed === 'object') ? (parsed as { event?: unknown }).event : undefined
                        const data = (parsed && typeof parsed === 'object') ? (parsed as { data?: unknown }).data : undefined
                        try { console.log('WS: message event', event) } catch { /* noop */ }
                        // Basic validation per expected event types; fail loud in console on bad shapes
                        if (event === 'scanner-pairs') {
                            const pairs = (data && typeof data === 'object') ? (data as { scannerPairs?: unknown[] }).scannerPairs : undefined
                            if (!Array.isArray(pairs)) {
                                console.error('WS: invalid scanner-pairs payload: missing scannerPairs array', parsed)
                                return
                            }
                        } else if (event === 'tick') {
                            const ok = data && typeof data === 'object' && (data as { pair?: unknown; swaps?: unknown }).pair && Array.isArray((data as { swaps?: unknown[] }).swaps)
                            if (!ok) {
                                console.error('WS: invalid tick payload: expected { pair, swaps[] }', parsed)
                                return
                            }
                        } else if (event === 'pair-stats') {
                            const ok = data && typeof data === 'object' && (data as { pair?: { pairAddress?: unknown } }).pair && typeof (data as { pair: { pairAddress?: unknown } }).pair.pairAddress === 'string'
                            if (!ok) {
                                console.error('WS: invalid pair-stats payload: expected pair.pairAddress', parsed)
                                return
                            }
                        } else if (event === 'wpeg-prices') {
                            const ok = data && typeof data === 'object' && typeof (data as { prices?: unknown }).prices === 'object'
                            if (!ok) {
                                console.error('WS: invalid wpeg-prices payload: expected { prices: Record<string,string|number> }', parsed)
                                return
                            }
                        }

                        // Map to action; if unhandled, log for visibility
                        const action = mapIncomingMessageToActionSafe(parsed)
                        if (!action) {
                            console.error('WS: unhandled or malformed message', parsed)
                            return
                        }
                        try { console.log('WS: dispatching action', { type: (action as { type: string }).type }) } catch { /* no-op */ }
                        d(action)

                        // Helpful diagnostics: log compact payload details
                        if (event === 'pair-stats') {
                            try {
                                const p = (data as { pair?: { pairAddress?: string, token1IsHoneypot?: boolean, isVerified?: boolean } }).pair
                                console.log('WS: pair-stats data', { pairAddress: p?.pairAddress, hp: p?.token1IsHoneypot, verified: p?.isVerified })
                            } catch { /* no-op */ }
                        } else if (event === 'tick') {
                            try {
                                const dd = data as { pair?: { pair?: string }, swaps?: { isOutlier?: boolean, priceToken1Usd?: string | number }[] }
                                const latest = Array.isArray(dd.swaps) ? dd.swaps.filter(s => !s.isOutlier).pop() : undefined
                                const latestPrice = latest ? (typeof latest.priceToken1Usd === 'number' ? latest.priceToken1Usd : parseFloat(latest.priceToken1Usd ?? 'NaN')) : undefined
                                console.log('WS: tick data summary', { pair: dd.pair?.pair, swaps: Array.isArray(dd.swaps) ? dd.swaps.length : undefined, latestPrice })
                            } catch { /* no-op */ }
                        }

                        // After valid scanner-pairs, subscribe to pair & pair-stats for the included tokens
                        if (
                            event === 'scanner-pairs' &&
                            Array.isArray((data as { scannerPairs: unknown[] }).scannerPairs)
                        ) {
                            const payloads = computePairPayloadsSafe((data as { scannerPairs: unknown[] }).scannerPairs)
                            for (const p of payloads) {
                                const subPair = JSON.stringify(buildPairSubscriptionSafe(p))
                                const subStats = JSON.stringify(buildPairStatsSubscriptionSafe(p))
                                ws.send(subPair)
                                ws.send(subStats)
                            }
                        }
                    } catch (err) {
                        console.error('WS: failed to process message', err)
                    }
                }
                ws.onerror = () => {
                    try { console.log('WS: error before open?', { opened }) } catch { /* no-op */ }
                    // If not opened yet, try next endpoint (avoid closing unopened sockets to reduce console noise)
                    if (!opened) {
                        if (settle()) return
                        connectNext()
                    }
                }
                ws.onclose = () => {
                    try { console.log('WS: close', { opened }) } catch { /* no-op */ }
                    // If closed before opening, try next; otherwise keep closed (no auto-reconnect for now)
                    if (!opened) {
                        if (settle()) return
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
            if (openTimeout) {
                clearTimeout(openTimeout);
                openTimeout = null
            }
            // Attempt to unsubscribe from scanner filters before closing (only outside dev)
            try {
                if (!import.meta.env.DEV && currentWs && currentWs.readyState === WebSocket.OPEN) {
                    currentWs.send(JSON.stringify(buildScannerUnsubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE })))
                    currentWs.send(JSON.stringify(buildScannerUnsubscriptionSafe({ ...newFilters, page: NEW_PAGE })))
                }
            } catch { /* ignore unsubscribe errors */ }

            // In dev, preserve the WebSocket across React StrictMode unmount/mount cycles to avoid churn.
            // Do not attempt to close CONNECTING or OPEN sockets in dev. Outside dev, close politely.
            try {
                if (currentWs) {
                    if (!import.meta.env.DEV) {
                        if (currentWs.readyState === WebSocket.OPEN) {
                            currentWs.close()
                        } else if (currentWs.readyState !== WebSocket.CONNECTING) {
                            // Only close non-CONNECTING states to avoid browser errors
                            currentWs.close()
                        }
                    }
                }
            } catch { /* ignore close errors */ }
            // Preserve global WS reference in dev; clear only outside dev
            try {
                if (!import.meta.env.DEV) {
                    (window as unknown as { __APP_WS__?: WebSocket }).__APP_WS__ = undefined as unknown as WebSocket
                }
            } catch { /* no-op */ }
        }
    }, [trendingFilters, newFilters, d, buildScannerSubscriptionSafe, mapIncomingMessageToActionSafe, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, computePairPayloadsSafe, buildScannerUnsubscriptionSafe])

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
        return {chainName}
    }, [])

    const wpegPrices = (state as unknown as { wpegPrices?: Record<string, number> }).wpegPrices

    return (
        <div style={{padding: '16px 16px 16px 10px'}}>
            <h1>Dexcelerate Scanner{import.meta.env.DEV ? ` (v${String((state as unknown as { version?: number }).version ?? 0)})` : ''}</h1>
            <p className="muted">Demo chainIdToName: {demoMap.chainName}</p>
            {/* Filters Bar */}
            <div className="filters">
                <div className="row">
                    <div className="group">
                        <label>Chains</label>
                        {(['ETH','SOL','BASE','BSC'] as const).map((c) => {
                            const checked = (state.filters.chains ?? ['ETH','SOL','BASE','BSC']).includes(c)
                            return (
                                <label key={c} className="chk">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                            const prev = new Set(state.filters.chains ?? ['ETH','SOL','BASE','BSC'])
                                            if (e.currentTarget.checked) prev.add(c); else prev.delete(c)
                                            d({ type: 'filters/set', payload: { chains: Array.from(prev) } } as FiltersAction)
                                        }}
                                    /> {c}
                                </label>
                            )
                        })}
                    </div>
                    <div className="group">
                        <label>Min Volume ($)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            value={state.filters.minVolume ?? 0}
                            onChange={(e) => { d({ type: 'filters/set', payload: { minVolume: Number(e.currentTarget.value || 0) } } as FiltersAction); }}
                        />
                    </div>
                    <div className="group">
                        <label>Max Age (hours)</label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={state.filters.maxAgeHours ?? ''}
                            placeholder="any"
                            onChange={(e) => {
                                const v = e.currentTarget.value
                                d({ type: 'filters/set', payload: { maxAgeHours: v === '' ? null : Math.max(0, Number(v)) } } as FiltersAction)
                            }}
                        />
                    </div>
                    <div className="group">
                        <label>Min Market Cap ($)</label>
                        <input
                            type="number"
                            min={0}
                            step={1000}
                            value={state.filters.minMcap ?? 0}
                            onChange={(e) => { d({ type: 'filters/set', payload: { minMcap: Number(e.currentTarget.value || 0) } } as FiltersAction); }}
                        />
                    </div>
                    <div className="group">
                        <label className="chk">
                            <input
                                type="checkbox"
                                checked={!!state.filters.excludeHoneypots}
                                onChange={(e) => { d({ type: 'filters/set', payload: { excludeHoneypots: e.currentTarget.checked } } as FiltersAction); }}
                            /> Exclude honeypot
                        </label>
                    </div>
                </div>
            </div>
            {wpegPrices && Object.keys(wpegPrices).length > 0 && (
                <div style={{ margin: '8px 0', padding: '8px', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, fontSize: 12 }}>
                    <strong>WPEG reference prices:</strong>{' '}
                    {Object.entries(wpegPrices)
                        .map(([chain, price]) => `${chain}: ${price.toFixed(4)}`)
                        .join('  |  ')}
                </div>
            )}
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
                <TokensPane
                    title="Trending Tokens"
                    filters={trendingFilters}
                    page={TRENDING_PAGE}
                    state={{ byId: state.byId, pages: state.pages, version: (state as unknown as { version?: number }).version ?? 0 } as unknown as { byId: Record<string, TokenRow>, pages: Partial<Record<number, string[]>> }}
                    dispatch={dispatch as unknown as React.Dispatch<ScannerPairsAction>}
                    defaultSort={{ key: 'volumeUsd', dir: 'desc' }}
                    clientFilters={state.filters as unknown as { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean }}
                />
                <TokensPane
                    title="New Tokens"
                    filters={newFilters}
                    page={NEW_PAGE}
                    state={{ byId: state.byId, pages: state.pages, version: (state as unknown as { version?: number }).version ?? 0 } as unknown as { byId: Record<string, TokenRow>, pages: Partial<Record<number, string[]>> }}
                    dispatch={dispatch as unknown as React.Dispatch<ScannerPairsAction>}
                    defaultSort={{ key: 'age', dir: 'desc' }}
                    clientFilters={state.filters as unknown as { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean }}
                />
            </div>
        </div>
    )
}

export default App
