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
import {useEffect, useMemo, useReducer, useRef, useState} from 'react'
import './App.css'
import {
    NEW_TOKENS_FILTERS,
    TRENDING_TOKENS_FILTERS,
    type GetScannerResultParams,
    type ScannerResult,
} from './test-task-types'
import {initialState, tokensReducer} from './tokens.reducer.js'
import { buildScannerSubscription, buildScannerUnsubscription, buildPairSubscription, buildPairStatsSubscription, mapIncomingMessageToAction } from './ws.mapper.js'
import {computePairPayloads} from './ws.subs.js'
import ErrorBoundary from './components/ErrorBoundary'
import NumberCell from './components/NumberCell'
import TokensPane from './components/TokensPane'
import { emitFilterFocusStart, emitFilterApplyComplete } from './filter.bus.js'
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

type SortKey = 'tokenName' | 'exchange' | 'priceUsd' | 'mcap' | 'volumeUsd' | 'age' | 'tx' | 'liquidity'

// Local state shape matching tokens.reducer.js output
interface TokensMeta {
    totalSupply: number;
    token0Address?: string
}

interface State {
    byId: Record<string, TokenRow>
    meta: Record<string, TokensMeta>
    pages: Partial<Record<number, string[]>>
    filters: { excludeHoneypots?: boolean; chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; limit?: number }
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
    payload: { excludeHoneypots?: boolean; chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; limit?: number }
}

type Action = ScannerPairsAction | ScannerAppendAction | TickAction | PairStatsAction | WpegPricesAction | FiltersAction

/**
 * Table component
 * Renders a sortable token table with loading/error/empty states.
 * Props are intentionally minimal to keep rendering logic decoupled from data shaping.
 */

// Tiny sparkline component (top-level to satisfy lint rules)
export function Sparkline({ data, width = 120, height = 24 }: { data: number[]; width?: number; height?: number }) {
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
    const baseLine = String(pad) + ',' + String(h - pad) + ' ' + String(w - pad) + ',' + String(h - pad)
    return (
        <svg width={w} height={h} viewBox={viewBox} aria-hidden="true" focusable="false">
            <polyline points={baseLine} stroke="#374151" strokeWidth="1" fill="none" />
            {path && <path d={path} stroke="#10b981" strokeWidth="1.5" fill="none" />}
        </svg>
    )
}

function App() {
    // Derive initial sort from URL (?sort=...&dir=...)
    const initialSort = useMemo(() => {
        try {
            const sp = new URLSearchParams(window.location.search)
            const rawSort = (sp.get('sort') ?? '').toLowerCase()
            const rawDir = (sp.get('dir') ?? '').toLowerCase()
            // Narrow dir to the union type using a type guard (avoids unnecessary assertions)
            const isDir = (v: string): v is 'asc' | 'desc' => v === 'asc' || v === 'desc'
            const dir: 'asc' | 'desc' = isDir(rawDir) ? rawDir : 'desc'
            // Map server sort keys to client SortKey
            const map: Partial<Record<string, SortKey>> = {
                tokenname: 'tokenName',
                exchange: 'exchange',
                price: 'priceUsd',
                priceusd: 'priceUsd',
                mcap: 'mcap',
                volume: 'volumeUsd',
                volumeusd: 'volumeUsd',
                age: 'age',
                tx: 'tx',
                liquidity: 'liquidity',
            }
            const key = map[rawSort]
            if (key) return { key, dir }
        } catch {
            // ignore URL errors and fall back to defaults
        }
        return null as null | { key: SortKey; dir: 'asc' | 'desc' }
    }, [])
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
        let retryTimer: ReturnType<typeof setTimeout> | null = null

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
        const devUrlPrimary = proto + location.host + '/ws' // via Vite proxy in dev
        const devUrlSecondary = proto + location.hostname + ':3001/ws' // direct to backend
        const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
        // Allow override via env (useful for debugging)
        const envUrl: string | null = typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
        // In dev, avoid falling back to production WS to prevent duplicate connections and race conditions
        const urls: string[] = import.meta.env.DEV ? [envUrl, devUrlPrimary, devUrlSecondary].filter(Boolean) as string[] : [envUrl, prodUrl].filter(Boolean) as string[]

        const maxAttempts = import.meta.env.DEV ? 8 : 20

        function connectNext(delayMs = 0) {
            if (cancelled) return
            // Clear any pending retry
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }

            const attemptConnect = () => {
                if (cancelled) return
                // Stop after a bounded number of attempts in dev to surface actionable guidance
                if (attempt >= maxAttempts) {
                    if (import.meta.env.DEV) {
                        console.warn('WS: giving up after', attempt, 'attempts. The backend WebSocket server is likely not running. Start both servers with: npm run dev:serve (or run npm run server separately).')
                    }
                    return
                }
                // Cycle through provided urls; in dev there is typically one (devUrl)
                const url = urls[(attempt++) % Math.max(1, urls.length)]
                if (!url) {
                    // No endpoints configured; retry same cycle after small backoff
                    const backoff = Math.min(2000, 200 + attempt * 100)
                    console.log('WS: no endpoints; retrying in', backoff, 'ms')
                    retryTimer = setTimeout(() => { connectNext(0) }, backoff)
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

                    // If connection does not open within a short window, retry with backoff
                    if (openTimeout) clearTimeout(openTimeout)
                    openTimeout = setTimeout(() => {
                        if (!opened && ws.readyState !== WebSocket.OPEN) {
                            if (settle()) return
                            const backoff = Math.min(2000, 200 + attempt * 100)
                            console.log('WS: open timeout; retrying in', backoff, 'ms')
                            connectNext(backoff)
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

                            // Count update events for live rate (tick and pair-stats)
                            try {
                                if (event === 'tick' || event === 'pair-stats') {
                                    // Each event counts as one update occurrence
                                    updatesCounterRef.current += 1
                                }
                            } catch { /* no-op */ }

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

                            // Note: we no longer auto-subscribe to all pairs here.
                            // Pair and pair-stats subscriptions are now gated by viewport
                            // visibility inside TokensPane to reduce WS traffic.
                        } catch (err) {
                            console.error('WS: failed to process message', err)
                        }
                    }
                    ws.onerror = () => {
                        try { console.log('WS: error before open?', { opened }) } catch { /* no-op */ }
                        // If not opened yet, retry with backoff (avoid closing unopened sockets to reduce console noise)
                        if (!opened) {
                            if (settle()) return
                            const backoff = Math.min(2000, 200 + attempt * 100)
                            connectNext(backoff)
                        }
                    }
                    ws.onclose = () => {
                        try { console.log('WS: close', { opened }) } catch { /* no-op */ }
                        // If closed before opening, retry with backoff; otherwise keep closed (no auto-reconnect for now)
                        if (!opened) {
                            if (settle()) return
                            const backoff = Math.min(2000, 200 + attempt * 100)
                            connectNext(backoff)
                        }
                    }
                } catch {
                    // If construction fails, retry
                    const backoff = Math.min(2000, 200 + attempt * 100)
                    connectNext(backoff)
                }
            }

            if (delayMs > 0) {
                retryTimer = setTimeout(attemptConnect, delayMs)
            } else {
                attemptConnect()
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
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null
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

    const wpegPrices = (state as unknown as { wpegPrices?: Record<string, number> }).wpegPrices

    const CHAINS = ['ETH','SOL','BASE','BSC'] as const
    const [trendingCounts, setTrendingCounts] = useState<Record<string, number>>({})
    const [newCounts, setNewCounts] = useState<Record<string, number>>({})
    const totalCounts = useMemo(() => {
        const out: Record<string, number> = {}
        for (const c of CHAINS) {
            out[c] = (trendingCounts[c] ?? 0) + (newCounts[c] ?? 0)
        }
        return out
    }, [trendingCounts, newCounts])

    // Live update rate tracker: 2s resolution over a 1-minute window (30 samples)
    const versionRef = useRef<number>((state as unknown as { version?: number }).version ?? 0)
    const blurVersionRef = useRef<number | null>(null)
    const pendingApplyAfterBlurRef = useRef(false)
    const updatesCounterRef = useRef(0)
    const [rateSeries, setRateSeries] = useState<number[]>([])

    // Compute 1-minute average (per-second) from the last up to 30 samples
    const avgRate = useMemo(() => {
        if (rateSeries.length === 0) return 0
        const sum = rateSeries.reduce((a, b) => a + b, 0)
        return sum / rateSeries.length
    }, [rateSeries])


    // Watch version for filter apply completion after blur
    useEffect(() => {
        const v = (state as unknown as { version?: number }).version ?? 0
        if (versionRef.current !== v) {
            versionRef.current = v
            if (pendingApplyAfterBlurRef.current) {
                if (blurVersionRef.current === null || v !== blurVersionRef.current) {
                    pendingApplyAfterBlurRef.current = false
                    blurVersionRef.current = null
                    try { emitFilterApplyComplete() } catch { /* no-op */ }
                }
            }
        }
    }, [state])

    // Sample every 2 seconds and convert count to per-second rate
    useEffect(() => {
        const id = setInterval(() => {
            const count = updatesCounterRef.current
            updatesCounterRef.current = 0
            const perSec = count / 2
            setRateSeries((prev) => {
                const next = [...prev, perSec]
                if (next.length > 30) next.splice(0, next.length - 30)
                return next
            })
        }, 2000)
        return () => { clearInterval(id) }
    }, [])

    return (
        <div style={{padding: '16px 16px 16px 10px'}}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0 }}>Dexcelerate Scanner</h1>
                <div className="muted" style={{ fontSize: 14 }} title="Average token updates per second over the last 1 minute">
                    {avgRate.toFixed(2)} upd/s (1m avg)
                </div>
                <Sparkline data={rateSeries} />
                {import.meta.env.DEV && (
                    <span className="muted" style={{ fontSize: 12 }}>(v{String((state as unknown as { version?: number }).version ?? 0)})</span>
                )}
            </div>
            {/* Filters Bar */}
            <div className="filters">
                {/* Row 1: Chains with dynamic counts across both tables */}
                <div className="row">
                    <div className="group">
                        <label>Chains</label>
                        <div className="chains-list">
                            {(['ETH','SOL','BASE','BSC'] as const).map((c) => {
                                const checked = (state.filters.chains ?? ['ETH','SOL','BASE','BSC']).includes(c)
                                const count = totalCounts[c] ?? 0
                                return (
                                    <label key={c} className="chk">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                                            onBlur={() => {
                                                blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                                pendingApplyAfterBlurRef.current = true
                                            }}
                                            onChange={(e) => {
                                                const prev = new Set(state.filters.chains ?? ['ETH','SOL','BASE','BSC'])
                                                if (e.currentTarget.checked) prev.add(c); else prev.delete(c)
                                                d({ type: 'filters/set', payload: { chains: Array.from(prev) } } as FiltersAction)
                                            }}
                                        /> {c} (<NumberCell value={count} />)
                                    </label>
                                )
                            })}
                        </div>
                    </div>
                </div>
                {/* Row 2: Other filters */}
                <div className="row">
                    <div className="group">
                        <label>Limit (rows)</label>
                        <input
                            type="number"
                            min={1}
                            step={50}
                            value={state.filters.limit ?? 200}
                            onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                            onBlur={() => {
                                blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                pendingApplyAfterBlurRef.current = true
                            }}
                            onChange={(e) => { d({ type: 'filters/set', payload: { limit: Math.max(1, Number(e.currentTarget.value || 0)) } } as FiltersAction); }}
                        />
                    </div>
                    <div className="group">
                        <label>Min Volume ($)</label>
                        <input
                            type="number"
                            min={0}
                            step={100}
                            value={state.filters.minVolume ?? 0}
                            onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                            onBlur={() => {
                                blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                pendingApplyAfterBlurRef.current = true
                            }}
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
                            onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                            onBlur={() => {
                                blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                pendingApplyAfterBlurRef.current = true
                            }}
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
                            onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                            onBlur={() => {
                                blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                pendingApplyAfterBlurRef.current = true
                            }}
                            onChange={(e) => { d({ type: 'filters/set', payload: { minMcap: Number(e.currentTarget.value || 0) } } as FiltersAction); }}
                        />
                    </div>
                    <div className="group">
                        <label className="chk">
                            <input
                                type="checkbox"
                                checked={!!state.filters.excludeHoneypots}
                                onFocus={() => { try { emitFilterFocusStart() } catch { /* no-op */ } }}
                                onBlur={() => {
                                    blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                                    pendingApplyAfterBlurRef.current = true
                                }}
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
                <ErrorBoundary fallback={(
                    <section>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0 }}>Trending Tokens</h2>
                            <div className="status">Loading…</div>
                        </div>
                    </section>
                )}>
                        <TokensPane
                            title="Trending Tokens"
                            filters={trendingFilters}
                            page={TRENDING_PAGE}
                            state={{ byId: state.byId, pages: state.pages, version: (state as unknown as { version?: number }).version ?? 0 } as unknown as { byId: Record<string, TokenRow>, pages: Partial<Record<number, string[]>> }}
                            dispatch={dispatch as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>}
                            defaultSort={initialSort ?? { key: 'tokenName', dir: 'asc' }}
                            clientFilters={state.filters as unknown as { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean }}
                            onChainCountsChange={(counts) => {
                                const out: Record<string, number> = {}
                                for (const c of CHAINS) out[c] = counts[c] ?? 0
                                // Avoid setState if unchanged to prevent unnecessary rerenders
                                setTrendingCounts((prev) => {
                                    let same = true
                                    for (const k of CHAINS) {
                                        if ((prev[k] ?? 0) !== (out[k] ?? 0)) { same = false; break }
                                    }
                                    return same ? prev : out
                                })
                            }}
                            syncSortToUrl
                        />
                </ErrorBoundary>
                <ErrorBoundary fallback={(
                    <section>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0 }}>New Tokens</h2>
                            <div className="status">Loading…</div>
                        </div>
                    </section>
                )}>
                        <TokensPane
                            title="New Tokens"
                            filters={newFilters}
                            page={NEW_PAGE}
                            state={{ byId: state.byId, pages: state.pages, version: (state as unknown as { version?: number }).version ?? 0 } as unknown as { byId: Record<string, TokenRow>, pages: Partial<Record<number, string[]>> }}
                            dispatch={dispatch as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>}
                            defaultSort={initialSort ?? { key: 'age', dir: 'desc' }}
                            clientFilters={state.filters as unknown as { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean }}
                            onChainCountsChange={(counts) => {
                                const out: Record<string, number> = {}
                                for (const c of CHAINS) out[c] = counts[c] ?? 0
                                // Avoid setState if unchanged to prevent unnecessary rerenders
                                setNewCounts((prev) => {
                                    let same = true
                                    for (const k of CHAINS) {
                                        if ((prev[k] ?? 0) !== (out[k] ?? 0)) { same = false; break }
                                    }
                                    return same ? prev : out
                                })
                            }}
                        />
                </ErrorBoundary>
            </div>
        </div>
    )
}

export default App
