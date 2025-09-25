import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Table from './Table'
import { fetchScanner } from '../scanner.client.js'
import { buildPairStatsSubscription, buildPairSubscription, buildPairUnsubscription, buildPairStatsUnsubscription, buildPairSlowSubscription, buildPairStatsSlowSubscription } from '../ws.mapper.js'
import { computePairPayloads } from '../ws.subs.js'
import { markVisible, markHidden, getCount } from '../visibility.bus.js'
import { onFilterFocusStart, onFilterApplyComplete } from '../filter.bus.js'
import type { GetScannerResultParams, ScannerResult } from '../test-task-types'

// Local minimal types mirroring the reducer output
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
    audit?: { contractVerified?: boolean; honeypot?: boolean; freezable?: boolean }
    security?: { renounced?: boolean; locked?: boolean; burned?: boolean }
    // Optional fields present in reducer mapping; used to form WS subscription payloads when rows render
    pairAddress?: string
    tokenAddress?: string
}

// Action aliases to satisfy TS strictly
interface ScannerPairsAction { type: 'scanner/pairs'; payload: { page: number; scannerPairs: unknown[] } }
interface ScannerAppendAction { type: 'scanner/append'; payload: { page: number; scannerPairs: unknown[] } }

type SortKey = 'tokenName' | 'exchange' | 'priceUsd' | 'mcap' | 'volumeUsd' | 'age' | 'tx' | 'liquidity'

type Dir = 'asc' | 'desc'

export default function TokensPane({
                                        title,
                                        filters,
                                        page,
                                        state,
                                        dispatch,
                                        defaultSort,
                                        clientFilters,
                                        onChainCountsChange,
                                        syncSortToUrl = false,
                                    }: {
    title: string
    filters: GetScannerResultParams
    page: number
    state: { byId: Record<string, TokenRow | undefined>, pages: Partial<Record<number, string[]>> } & { version?: number }
    dispatch: React.Dispatch<ScannerPairsAction | ScannerAppendAction>
    defaultSort: { key: SortKey; dir: Dir }
    clientFilters?: { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean; limit?: number }
    onChainCountsChange?: (counts: Record<string, number>) => void
    syncSortToUrl?: boolean
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sort, setSort] = useState(defaultSort)
    // Infinite scroll state
    const [visibleCount, setVisibleCount] = useState(50)
    const [currentPage, setCurrentPage] = useState(1)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    const [bothEndsVisible, setBothEndsVisible] = useState(false)

    const wsRef = useRef<WebSocket | null>(null)
    const payloadsRef = useRef<{ pair: string; token: string; chain: string }[]>([])
    const rowsRef = useRef<TokenRow[]>([])
    const scrollingRef = useRef<boolean>(false)
    // Track last update timestamps per key and previous value snapshots
    const lastUpdatedRef = useRef<Map<string, number>>(new Map())
    const prevSnapRef = useRef<Map<string, { price: number; mcap: number; vol: number; buys: number; sells: number; liq: number }>>(new Map())
    // Track previously rendered keys to unsubscribe when rows fall out due to limit/sort
    const prevRenderedKeysRef = useRef<Set<string>>(new Set())

    // Normalize chain to the server's expected id format for subscriptions
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

    // Fetch function as typed alias to keep TS happy with JS module
    const fetchScannerTyped = fetchScanner as unknown as (p: GetScannerResultParams) => Promise<{ raw: { page?: number | null; scannerPairs?: ScannerResult[] | null } }>
    const buildPairSubscriptionSafe = buildPairSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair'; data: { pair: string; token: string; chain: string } }
    const buildPairSlowSubscriptionSafe = buildPairSlowSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair-slow'; data: { pair: string; token: string; chain: string } }
    const buildPairStatsSubscriptionSafe = buildPairStatsSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair-stats'; data: { pair: string; token: string; chain: string } }
    const buildPairStatsSlowSubscriptionSafe = buildPairStatsSlowSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair-stats-slow'; data: { pair: string; token: string; chain: string } }
    const computePairPayloadsSafe = computePairPayloads as unknown as (items: ScannerResult[] | unknown[]) => { pair: string; token: string; chain: string }[]

    // Track currently visible and slow subscription keys (pair|token|chain)
    const visibleKeysRef = useRef<Set<string>>(new Set())
    const slowKeysRef = useRef<Set<string>>(new Set())
    // Scheduler state for staggered slow re-subscriptions after scroll stops
    // - slowResubQueueRef holds keys to (re)subscribe at slow rate
    // - slowResubIntervalRef drives per-second batching; cleared on new scroll or unmount
    const slowResubQueueRef = useRef<string[]>([])
    const slowResubIntervalRef = useRef<number | null>(null)
    // Start-delay timer for slow re-subscriptions after scroll stop (debounce rapid stop-starts)
    const slowResubStartTimeoutRef = useRef<number | null>(null)

    // Allow App to share a single WebSocket but also support direct sends if present on window.
    useEffect(() => {
        // Discover the shared WS ref stashed by App (escape hatch to avoid extra props)
        const anyWin = window as unknown as { __APP_WS__?: WebSocket }
        wsRef.current = anyWin.__APP_WS__ ?? null
        try {
            const rs = wsRef.current?.readyState
            console.log('[TokensPane:' + title + '] mount; discovered __APP_WS__ readyState=' + String(rs))
        } catch { /* no-op */ }
    }, [title])

    // Poll briefly for __APP_WS__ becoming available, then log detection
    useEffect(() => {
        let tries = 0
        const maxTries = 20 // ~10s at 500ms
        const interval = setInterval(() => {
            tries++
            const anyWin = window as unknown as { __APP_WS__?: WebSocket }
            const ws = anyWin.__APP_WS__ ?? null
            if (ws && wsRef.current !== ws) {
                wsRef.current = ws
                console.log('[TokensPane:' + title + '] detected __APP_WS__ later; readyState=' + String(ws.readyState))
                // If socket is OPEN, (re)send subscriptions for currently visible keys
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        const keys = Array.from(visibleKeysRef.current)
                        console.log('[TokensPane:' + title + '] late attach subscribing visible keys:', keys.length)
                        for (const key of keys) {
                            const [pair, token, chain] = key.split('|')
                            const { prev } = markVisible(key)
                            if (prev === 0) {
                                ws.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                                ws.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
                            }
                        }
                    } catch (err) {
                        console.error(`[TokensPane:${title}] failed to send late subscriptions`, err)
                    }
                }
            }
            if (tries >= maxTries || wsRef.current) {
                clearInterval(interval)
            }
        }, 500)
        return () => { clearInterval(interval) }
    }, [buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, title])

    // Initial REST load (page must start at 1 for every pane)
    useEffect(() => {
        let cancelled = false
        // reset infinite scroll state on new mount/filters
        setVisibleCount(50)
        setCurrentPage(1)
        setHasMore(true)
        // If the client filters specify no chains selected, freeze the pane: clear rows and skip fetching.
        const chainsProvidedEmpty = Array.isArray(clientFilters?.chains) && clientFilters.chains.length === 0
        if (chainsProvidedEmpty) {
            try {
                dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
            } catch { /* no-op */ }
            setLoading(false)
            setHasMore(false)
            return () => { /* frozen: nothing to cleanup */ }
        }
        const run = async () => {
            setLoading(true)
            setError(null)
            try {
                console.log('[TokensPane:' + title + '] fetching initial scanner page with filters', { ...filters, page: 1 })
                const res = await fetchScannerTyped({ ...filters, page: 1 })
                if (cancelled) return
                const raw = res.raw as unknown
                // Strict shape check: expect an object with scannerPairs: array
                const scannerPairs = (raw && typeof raw === 'object' && Array.isArray((raw as { scannerPairs?: unknown[] }).scannerPairs))
                    ? (raw as { scannerPairs: unknown[] }).scannerPairs
                    : null
                if (!scannerPairs) {
                    const errMsg = 'Unexpected data shape from /scanner: missing or invalid scannerPairs array'
                    // Surface loudly in console and UI
                    console.error(errMsg, raw)
                    // Mark page as initialized with no rows so App overlay can clear
                    try { dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } }) } catch { /* no-op */ }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (!cancelled) setError(errMsg)
                    return
                }
                const list = scannerPairs
                console.log('[TokensPane:' + title + '] /scanner returned ' + String(list.length) + ' items')
                // Deduplicate by pairAddress (case-insensitive) before computing payloads/dispatching
                const seenPairsLower = new Set<string>()
                const dedupedList: unknown[] = []
                for (const it of list as ScannerResult[]) {
                    const addr = (it as unknown as { pairAddress?: string }).pairAddress
                    const k = typeof addr === 'string' ? addr.toLowerCase() : ''
                    if (k && !seenPairsLower.has(k)) {
                        seenPairsLower.add(k)
                        dedupedList.push(it)
                    }
                }
                if (dedupedList.length !== list.length) {
                    console.log('[TokensPane:' + title + '] deduped initial list: ' + String(list.length - dedupedList.length) + ' duplicates removed')
                }
                // Update local ids for this pane only
                const payloads = computePairPayloadsSafe(dedupedList as ScannerResult[])
                payloadsRef.current = payloads
                // Deduplicate pair ids for this pane to avoid duplicate row keys (computePairPayloads emits chain variants)
                const seenPairs = new Set<string>()
                const localIds: string[] = []
                for (const p of payloads) {
                    if (!seenPairs.has(p.pair)) {
                        seenPairs.add(p.pair)
                        localIds.push(p.pair)
                    }
                }
                console.log('[TokensPane:' + title + `] computed ${String(payloads.length)} pair subscription payloads and ${String(localIds.length)} unique pair ids for table`)
                // Merge into global store (byId/meta) — page value is irrelevant for panes
                dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: list } })
                // Do not subscribe all pairs here; subscriptions are gated by row viewport visibility.
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load data'
                console.error('[TokensPane:' + title + '] fetch failed', e)
                // Mark page as initialized with no rows so App overlay can clear
                try { dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } }) } catch { /* no-op */ }
                if (!cancelled) setError(msg)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        void run()
        return () => { cancelled = true }
    }, [filters, clientFilters, dispatch, fetchScannerTyped, computePairPayloadsSafe, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, page, title])

    // Derive rows for this pane from global byId
    const rows = useMemo(() => {
        // Derive strictly from the ids assigned to this pane's page to avoid mixing datasets
        const ids = state.pages[page] ?? []
        const listed = Array.isArray(ids) ? ids : []
        const collected: TokenRow[] = []
        for (const id of listed) {
            const lowerId = typeof id === 'string' ? id.toLowerCase() : String(id).toLowerCase()
            const t = state.byId[id] ?? state.byId[lowerId]
            if (t) collected.push(t)
        }
        // Apply client-side filters before sorting/truncation
        const cf = clientFilters ?? {}
        // If chains is provided, respect it exactly. An empty array means "no chains selected",
        // which should result in zero rows rendered (and thus a frozen pane).
        const selectedChains = Array.isArray(cf.chains) ? new Set(cf.chains) : null
        const minVol = cf.minVolume ?? 0
        const minMcap = cf.minMcap ?? 0
        const maxAgeMs = (cf.maxAgeHours == null || Number.isNaN(cf.maxAgeHours)) ? null : Math.max(0, cf.maxAgeHours) * 3600_000
        const now = Date.now()
        const filtered = collected.filter((t) => {
            if (selectedChains && !selectedChains.has(t.chain)) return false
            if (t.volumeUsd < minVol) return false
            if (t.mcap < minMcap) return false
            if (maxAgeMs != null) {
                const ageMs = Math.max(0, now - t.tokenCreatedTimestamp.getTime())
                if (ageMs > maxAgeMs) return false
            }
            if (cf.excludeHoneypots) {
                if (t.audit && typeof t.audit.honeypot === 'boolean') {
                    if (t.audit.honeypot) return false
                }
            }
            return true
        })
        // Fallback: if page has no ids yet (e.g., before first WS/REST), show empty until data arrives
        const base = filtered
        const sorter = (key: SortKey, dir: Dir) => (a: TokenRow, b: TokenRow) => {
            const getVal = (t: TokenRow): number | string => {
                switch (key) {
                    case 'age': return t.tokenCreatedTimestamp.getTime()
                    case 'tx': return t.transactions.buys + t.transactions.sells
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
            let cmp
            if (typeof va === 'string' && typeof vb === 'string') cmp = va.localeCompare(vb)
            else cmp = (va as number) < (vb as number) ? -1 : (va as number) > (vb as number) ? 1 : 0
            return dir === 'asc' ? cmp : -cmp
        }
        const sorted = [...base].sort(sorter(sort.key, sort.dir))
        const limit = (clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0) ? clientFilters.limit : Number.POSITIVE_INFINITY
        const cap = Math.min(visibleCount, limit)
        const out = sorted.slice(0, Number.isFinite(cap) ? cap : visibleCount)
        return out
    }, [state.byId, state.pages, page, sort, clientFilters, visibleCount])

    // Keep a ref of latest rows for late WS attach logic
    useEffect(() => {
        rowsRef.current = rows
        // Update last-updated timestamps by diffing significant fields per key
        try {
            const prev = prevSnapRef.current
            for (const row of rows) {
                const pair = row.pairAddress
                const token = row.tokenAddress
                if (!pair || !token) continue
                const key = pair + '|' + token + '|' + toChainId(row.chain)
                const snap = { price: row.priceUsd, mcap: row.mcap, vol: row.volumeUsd, buys: row.transactions.buys, sells: row.transactions.sells, liq: row.liquidity.current }
                const old = prev.get(key)
                if (!old || old.price !== snap.price || old.mcap !== snap.mcap || old.vol !== snap.vol || old.buys !== snap.buys || old.sells !== snap.sells || old.liq !== snap.liq) {
                    lastUpdatedRef.current.set(key, Date.now())
                    prev.set(key, snap)
                }
            }
        } catch { /* no-op */ }
    }, [rows])

    // Emit per-chain counts of currently rendered rows to parent (for combined counts)
    useEffect(() => {
        if (!onChainCountsChange) return
        try {
            const counts: Record<string, number> = {}
            for (const r of rows) {
                const c = r.chain
                counts[c] = (counts[c] ?? 0) + 1
            }
            onChainCountsChange(counts)
        } catch { /* no-op */ }
    }, [rows, onChainCountsChange])

    // When the rendered rows change (due to limit/sort), unsubscribe keys that dropped out entirely
    useEffect(() => {
        try {
            const currentKeys = new Set<string>()
            for (const row of rows) {
                const pair = row.pairAddress
                const token = row.tokenAddress
                if (!pair || !token) continue
                const key = pair + '|' + token + '|' + toChainId(row.chain)
                currentKeys.add(key)
            }
            const prev = prevRenderedKeysRef.current
            const removed: string[] = []
            for (const key of prev) {
                if (!currentKeys.has(key)) removed.push(key)
            }
            prevRenderedKeysRef.current = currentKeys

            const ws = wsRef.current
            if (removed.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
                for (const key of removed) {
                    try {
                        // purge local tracking
                        visibleKeysRef.current.delete(key)
                        slowKeysRef.current.delete(key)
                        const idx = slowResubQueueRef.current.indexOf(key)
                        if (idx >= 0) slowResubQueueRef.current.splice(idx, 1)
                        // only unsubscribe if no pane has it visible (fast)
                        if (getCount(key) === 0) {
                            const [pair, token, chain] = key.split('|')
                            ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                            ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                        }
                    } catch (err) {
                        console.error(`[TokensPane:${title}] unsubscribe on removal failed for`, key, String(err))
                    }
                }
            }
        } catch { /* no-op */ }
    }, [rows, title])

    // Log rows derivation once per version to avoid duplicate logs under React StrictMode
    const lastLoggedVersionRef = useRef<number>(-1)
    useEffect(() => {
        try {
            const version = state.version ?? 0
            if (lastLoggedVersionRef.current !== version) {
                lastLoggedVersionRef.current = version
                if (rows.length > 0) {
                    const first = rows[0]
                    console.log(`[TokensPane:${title}] rows derived`, { count: rows.length, firstId: first.id, firstPrice: first.priceUsd, version })
                } else {
                    console.log(`[TokensPane:${title}] rows derived`, { count: 0, version })
                }
            }
        } catch { /* no-op */ }
    }, [rows, state.version, title])

    const onSort = (k: SortKey) => {
        setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))
    }

    // Sync sort changes to URL query params (?sort=...&dir=...)
    useEffect(() => {
        if (!syncSortToUrl) return
        try {
            const sp = new URLSearchParams(window.location.search)
            // Write client sort keys directly; server accepts both aliases per README
            sp.set('sort', sort.key)
            sp.set('dir', sort.dir)
            const nextSearch = `?${sp.toString()}`
            const cur = window.location.pathname + window.location.search
            const next = window.location.pathname + nextSearch
            // Avoid redundant history updates which can cause dev-server page flashes
            if (next !== cur) {
                window.history.replaceState(null, '', next)
            }
        } catch {
            // ignore URL errors
        }
    }, [sort, syncSortToUrl])

    // Viewport-gated subscriptions are handled via onRowVisibilityChange below.

    // Imperative loadMore function (memoized)
    const loadMore = useCallback(async () => {
        // If no rows are rendered, freeze load-more regardless of which filter caused it.
        if (rowsRef.current.length === 0) return
        if (bothEndsVisible) return
        if (loadingMore || !hasMore) return
        setLoadingMore(true)
        try {
            const nextPage = currentPage + 1
            console.log(`[TokensPane:${title}] loading more: page ${String(nextPage)}`)
            const res = await fetchScannerTyped({ ...filters, page: nextPage })
            const raw = res.raw as unknown
            const list = (raw && typeof raw === 'object' && Array.isArray((raw as { scannerPairs?: unknown[] }).scannerPairs))
                ? (raw as { scannerPairs: unknown[] }).scannerPairs
                : []
            // Deduplicate by pairAddress (case-insensitive)
            const seenPairsLower = new Set<string>()
            const dedupedList: unknown[] = []
            for (const it of list as ScannerResult[]) {
                const addr = (it as unknown as { pairAddress?: string }).pairAddress
                const k = typeof addr === 'string' ? addr.toLowerCase() : ''
                if (k && !seenPairsLower.has(k)) {
                    seenPairsLower.add(k)
                    dedupedList.push(it)
                }
            }
            // Dispatch typed append
            dispatch({ type: 'scanner/append', payload: { page, scannerPairs: dedupedList } } as ScannerAppendAction)
            // Increase visible count so user sees more rows immediately
            setVisibleCount((c) => c + 50)
            setCurrentPage(nextPage)
            if (dedupedList.length === 0) {
                setHasMore(false)
            }
        } catch (err) {
            console.error(`[TokensPane:${title}] loadMore failed`, err)
            // On error, stop auto-loading to prevent tight loops
            setHasMore(false)
        } finally {
            setLoadingMore(false)
        }
    }, [loadingMore, hasMore, currentPage, fetchScannerTyped, filters, dispatch, page, title, bothEndsVisible])

    // Load more on intersection (infinite scroll)
    useEffect(() => {
        if (!sentinelRef.current) return
        // If there are no rows (all filtered out), do not attach observer (prevents thrash/infinite requests).
        if (rowsRef.current.length === 0) return
        // Disable infinite scroll when both header and footer are visible
        if (bothEndsVisible) return
        const el = sentinelRef.current
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    void loadMore()
                }
            }
        }, { root: null, rootMargin: '200px', threshold: 0 })
        observer.observe(el)
        return () => { observer.unobserve(el); observer.disconnect() }
    }, [loadMore, clientFilters, bothEndsVisible])

    // Handler wired to Table row visibility
    const onRowVisibilityChange = useCallback((row: TokenRow, visible: boolean) => {
        if (scrollingRef.current) return
        const pair = row.pairAddress
        const token = row.tokenAddress
        if (!pair || !token) return
        const chain = toChainId(row.chain)
        const key = pair + '|' + token + '|' + chain
        const fastSet = visibleKeysRef.current
        const slowSet = slowKeysRef.current
        const ws = wsRef.current
        if (visible) {
            // promote to fast (only if this pane wasn't already tracking it)
            slowSet.delete(key)
            if (!fastSet.has(key)) {
                const { prev } = markVisible(key)
                fastSet.add(key)
                // Only send a fast subscription when this pane is the first visible viewer
                if (prev === 0 && ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                        ws.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
                    } catch (err) {
                        console.error(`[TokensPane:${title}] subscribe failed for`, key, err)
                    }
                }
            }
        } else {
            const wasFast = fastSet.has(key)
            if (wasFast) fastSet.delete(key)
            if (!slowSet.has(key)) slowSet.add(key)
            if (wasFast) {
                const { next } = markHidden(key)
                // Only downgrade to slow if no other pane is still viewing it
                if (next === 0 && ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify(buildPairSlowSubscriptionSafe({ pair, token, chain })))
                        ws.send(JSON.stringify(buildPairStatsSlowSubscriptionSafe({ pair, token, chain })))
                    } catch (err) {
                        console.error(`[TokensPane:${title}] slow-subscribe failed for`, key, err)
                    }
                }
            }
        }
    }, [title, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, buildPairSlowSubscriptionSafe, buildPairStatsSlowSubscriptionSafe])

    // Unsubscribe all visible on unmount (outside dev optional)
    useEffect(() => {
        // Snapshot refs at effect creation to satisfy react-hooks rules
        const wsAtMount = wsRef.current
        const setAtMount = visibleKeysRef.current
        return () => {
            try {
                const ws = wsAtMount
                const keys = Array.from(setAtMount)
                if (ws && ws.readyState === WebSocket.OPEN) {
                    for (const key of keys) {
                        const [pair, token, chain] = key.split('|')
                        // On unmount, this pane is no longer a visible viewer for these keys
                        const { next } = markHidden(key)
                        // Only unsubscribe if no other pane still requires the fast subscription
                        if (next === 0) {
                            ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                            ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                        }
                    }
                }
                setAtMount.clear()
            } catch { /* ignore unmount unsubscribe errors */ }
        }
    }, [])

    // React to filter focus/apply events to control subscriptions around filtering interactions
    useEffect(() => {
        const ws = () => wsRef.current

        function computeAllKeys(): { keys: string[]; mapIndexToKey: string[] } {
            const mapIndexToKey: string[] = []
            for (const row of rowsRef.current) {
                const pair = row.pairAddress ?? ''
                const token = row.tokenAddress ?? ''
                if (!pair || !token) { mapIndexToKey.push(''); continue }
                const chain = toChainId(row.chain)
                mapIndexToKey.push(pair + '|' + token + '|' + chain)
            }
            const keys = mapIndexToKey.filter(Boolean)
            return { keys, mapIndexToKey }
        }

        const offFocus = onFilterFocusStart(() => {
            // Pause any scheduled resubscriptions and mark as scrolling-like freeze
            scrollingRef.current = true
            if (slowResubIntervalRef.current != null) {
                try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                slowResubIntervalRef.current = null
            }
            if (slowResubStartTimeoutRef.current != null) {
                try { window.clearTimeout(slowResubStartTimeoutRef.current) } catch { /* no-op */ }
                slowResubStartTimeoutRef.current = null
            }

            const w = ws()
            // Determine keep window: current visible indices ±3
            const { mapIndexToKey } = computeAllKeys()
            const keepIndex = new Set<number>()
            const visibleSet = new Set<string>(visibleKeysRef.current)
            for (let i = 0; i < mapIndexToKey.length; i++) {
                const key = mapIndexToKey[i]
                if (!key) continue
                if (visibleSet.has(key)) {
                    for (let j = Math.max(0, i - 3); j <= Math.min(mapIndexToKey.length - 1, i + 3); j++) {
                        keepIndex.add(j)
                    }
                }
            }
            const keepKeys = new Set<string>()
            for (const i of keepIndex) {
                const k = mapIndexToKey[i]
                if (k) keepKeys.add(k)
            }

            // Build snapshots of current tracking
            const fastNow = new Set<string>(visibleKeysRef.current)
            const slowNow = new Set<string>(slowKeysRef.current)
            // Retain queued keys only if within keep window
            slowResubQueueRef.current = slowResubQueueRef.current.filter((k) => keepKeys.has(k))

            // Unsubscribe any not in keep window
            const wss = w && w.readyState === WebSocket.OPEN ? w : null
            if (wss) {
                // Fast ones
                for (const key of Array.from(fastNow)) {
                    if (keepKeys.has(key)) continue
                    visibleKeysRef.current.delete(key)
                    try {
                        const { next } = markHidden(key)
                        if (next === 0) {
                            const [pair, token, chain] = key.split('|')
                            wss.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                            wss.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                        }
                    } catch (err) {
                        console.error(`[TokensPane:${title}] filter-focus fast unsubscribe failed`, key, String(err))
                    }
                }
                // Slow ones
                for (const key of Array.from(slowNow)) {
                    if (keepKeys.has(key)) continue
                    slowKeysRef.current.delete(key)
                    try {
                        if (getCount(key) === 0) {
                            const [pair, token, chain] = key.split('|')
                            wss.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                            wss.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                        }
                    } catch (err) {
                        console.error(`[TokensPane:${title}] filter-focus slow unsubscribe failed`, key, String(err))
                    }
                }
            }
        })

        const offApply = onFilterApplyComplete(() => {
            // Resume subscriptions using existing stagger logic
            const wss = ws()
            scrollingRef.current = false
            if (!wss || wss.readyState !== WebSocket.OPEN) return

            // Compute visKeys from current visible set
            const visKeys = Array.from(visibleKeysRef.current)
            // Compute all rendered keys
            const allRendered: string[] = []
            for (const row of rowsRef.current) {
                const pair = row.pairAddress ?? ''
                const token = row.tokenAddress ?? ''
                if (!pair || !token) continue
                const chain = toChainId(row.chain)
                allRendered.push(pair + '|' + token + '|' + chain)
            }
            const visSet = new Set(visKeys)
            const slowKeys: string[] = []
            for (const key of allRendered) {
                if (!visSet.has(key) && getCount(key) === 0) slowKeys.push(key)
            }

            // Fast subs immediately
            for (const key of visKeys) {
                const [pair, token, chain] = key.split('|')
                try {
                    const { prev } = markVisible(key)
                    if (prev === 0) {
                        wss.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                        wss.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
                    }
                } catch (err) {
                    console.error(`[TokensPane:${title}] filter-apply fast resub failed`, key, String(err))
                }
            }

            // Queue slow with same schedule as onScrollStop
            const totalAll = visKeys.length + slowKeys.length
            const estimatedSlowFactor = Math.max(200, Math.ceil(totalAll / 4))
            const batchPerSecond = Math.max(1, Math.ceil(totalAll / estimatedSlowFactor))

            if (slowResubIntervalRef.current != null) {
                try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                slowResubIntervalRef.current = null
            }
            if (slowResubStartTimeoutRef.current != null) {
                try { window.clearTimeout(slowResubStartTimeoutRef.current) } catch { /* no-op */ }
                slowResubStartTimeoutRef.current = null
            }
            slowResubQueueRef.current = [...slowKeys]

            const tick = () => {
                const remaining = slowResubQueueRef.current.length
                if (remaining <= 0) {
                    if (slowResubIntervalRef.current != null) {
                        try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                        slowResubIntervalRef.current = null
                    }
                    return
                }
                const quota = Math.min(batchPerSecond, remaining)
                for (let i = 0; i < quota; i++) {
                    const key = slowResubQueueRef.current.shift()
                    if (!key) break
                    const [pair, token, chain] = key.split('|')
                    try {
                        wss.send(JSON.stringify(buildPairSlowSubscriptionSafe({ pair, token, chain })))
                        wss.send(JSON.stringify(buildPairStatsSlowSubscriptionSafe({ pair, token, chain })))
                    } catch (err) {
                        console.error(`[TokensPane:${title}] filter-apply slow resub failed`, key, String(err))
                    }
                }
            }
            // Start after 1s debounce
            slowResubStartTimeoutRef.current = window.setTimeout(() => {
                tick()
                slowResubIntervalRef.current = window.setInterval(tick, 1000)
            }, 1000)
        })

        return () => { offFocus(); offApply() }
    }, [title, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, buildPairSlowSubscriptionSafe, buildPairStatsSlowSubscriptionSafe])

    // Ensure any stagger timers are cleaned up on unmount
    useEffect(() => {
        return () => {
            if (slowResubIntervalRef.current != null) {
                try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                slowResubIntervalRef.current = null
            }
            if (slowResubStartTimeoutRef.current != null) {
                try { window.clearTimeout(slowResubStartTimeoutRef.current) } catch { /* no-op */ }
                slowResubStartTimeoutRef.current = null
            }
            slowResubQueueRef.current = []
        }
    }, [])

    return (
        <div>
            <Table
                title={title}
                rows={rows}
                loading={loading}
                error={error}
                onSort={onSort}
                sortKey={sort.key}
                sortDir={sort.dir}
                onRowVisibilityChange={onRowVisibilityChange}
                onBothEndsVisible={(v) => { setBothEndsVisible(v) }}
                onScrollStart={() => {
                    // Enter scrolling: pause any in-flight slow re-subscription schedule and clear its queue
                    scrollingRef.current = true
                    if (slowResubIntervalRef.current != null) {
                        try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                        slowResubIntervalRef.current = null
                    }
                    slowResubQueueRef.current = []

                    const ws = wsRef.current
                    const visibleNow = new Set<string>(visibleKeysRef.current)
                    const slowNow = new Set<string>(slowKeysRef.current)
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        // Unsubscribe fast keys only if this pane is the sole visible viewer
                        for (const key of visibleNow) {
                            const [pair, token, chain] = key.split('|')
                            try {
                                // Decrement this pane's visibility before deciding to unsubscribe
                                const { next } = markHidden(key)
                                if (next === 0) {
                                    ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                                    ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                                }
                            } catch (err) {
                                console.error(`[TokensPane:${title}] bulk-unsubscribe failed for`, key, String(err))
                            }
                        }
                        // Unsubscribe slow keys only if no pane currently views them
                        for (const key of slowNow) {
                            const [pair, token, chain] = key.split('|')
                            try {
                                if (getCount(key) === 0) {
                                    ws.send(JSON.stringify(buildPairUnsubscription({ pair, token, chain })))
                                    ws.send(JSON.stringify(buildPairStatsUnsubscription({ pair, token, chain })))
                                }
                            } catch (err) {
                                console.error(`[TokensPane:${title}] bulk-unsubscribe slow failed for`, key, String(err))
                            }
                        }
                    }
                    visibleKeysRef.current.clear()
                    slowKeysRef.current.clear()
                }}
                getRowStatus={(row: TokenRow) => {
                    const pair = row.pairAddress ?? ''
                    const token = row.tokenAddress ?? ''
                    if (!pair || !token) return undefined
                    const key = pair + '|' + token + '|' + toChainId(row.chain)
                    const ts = lastUpdatedRef.current.get(key)
                    const tooltip = ts ? new Date(ts).toLocaleString() : 'No updates yet'
                    if (scrollingRef.current) return { state: 'unsubscribed', tooltip }
                    if (visibleKeysRef.current.has(key)) return { state: 'fast', tooltip }
                    if (slowKeysRef.current.has(key)) return { state: 'slow', tooltip }
                    if (slowResubQueueRef.current.includes(key)) return { state: 'queued-slow', tooltip }
                    // Default: consider as slow if nothing else is known
                    return { state: 'slow', tooltip }
                }}
                onScrollStop={(visibleRows: TokenRow[]) => {
                    const ws = wsRef.current
                    scrollingRef.current = false
                    // Compute visible keys
                    const visKeys: string[] = []
                    for (const row of visibleRows) {
                        const pair = row.pairAddress ?? ''
                        const token = row.tokenAddress ?? ''
                        if (!pair || !token) continue
                        const chain = toChainId(row.chain)
                        const key = pair + '|' + token + '|' + chain
                        visKeys.push(key)
                    }
                    const visSet = new Set(visKeys)
                    const allRenderedKeys: string[] = []
                    for (const row of rowsRef.current) {
                        const pair = row.pairAddress ?? ''
                        const token = row.tokenAddress ?? ''
                        if (!pair || !token) continue
                        const chain = toChainId(row.chain)
                        allRenderedKeys.push(pair + '|' + token + '|' + chain)
                    }
                    const slowKeys: string[] = []
                    for (const key of allRenderedKeys) {
                        // Only consider keys not visible in this pane AND not visible in any pane
                        if (!visSet.has(key) && getCount(key) === 0) slowKeys.push(key)
                    }

                    // Resubscribe strategy after scroll stops:
                    // 1) Immediately re-enable FAST subscriptions for visible rows so UI becomes live right away.
                    // 2) For INVISIBLE rows, stagger re-subscription over time using the same effective throttle
                    //    that the server applies to slow updates. The server assigns a per-key slowFactor approximately as:
                    //       slowFactor = max(200, ceil(totalRows / 4))
                    //    where totalRows is the number of known rows on the server. We approximate totalRows here with the
                    //    total rendered rows in this pane (visible + invisible). The resulting portion of all rows that gets
                    //    re-subscribed per second is 1 / slowFactor. For example, if slowFactor = 200, we re-subscribe ~0.5%
                    //    of all rows per second. This avoids a thundering herd while ensuring off-viewport data comes back
                    //    online smoothly.
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        // 1) Fast (visible) rows: immediate pair + stats subscriptions
                        for (const key of visKeys) {
                            const [pair, token, chain] = key.split('|')
                            try {
                                const { prev } = markVisible(key)
                                if (prev === 0) {
                                    ws.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                                    ws.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
                                }
                            } catch (err) {
                                console.error(`[TokensPane:${title}] resubscribe fast failed for`, key, String(err))
                            }
                        }

                        // 2) Invisible rows: stagger slow subscriptions using per-second batching derived from the same math
                        //    the server uses for slow updates. UX impact:
                        //    - Visible rows are snappy (instant updates).
                        //    - Invisible rows trickle back in over time, preventing WS/CPU spikes on large tables.
                        const totalAll = visKeys.length + slowKeys.length
                        const estimatedSlowFactor = Math.max(200, Math.ceil(totalAll / 4))
                        // Portion per second = 1 / slowFactor; translate to a batch count per tick (per ~1s).
                        const batchPerSecond = Math.max(1, Math.ceil(totalAll / estimatedSlowFactor))

                        // Prepare queue and clear any previous schedule
                        if (slowResubIntervalRef.current != null) {
                            try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                            slowResubIntervalRef.current = null
                        }
                        if (slowResubStartTimeoutRef.current != null) {
                            try { window.clearTimeout(slowResubStartTimeoutRef.current) } catch { /* no-op */ }
                            slowResubStartTimeoutRef.current = null
                        }
                        slowResubQueueRef.current = [...slowKeys]

                        const tick = () => {
                            const remaining = slowResubQueueRef.current.length
                            if (remaining <= 0) {
                                if (slowResubIntervalRef.current != null) {
                                    try { window.clearInterval(slowResubIntervalRef.current) } catch { /* no-op */ }
                                    slowResubIntervalRef.current = null
                                }
                                return
                            }
                            const quota = Math.min(batchPerSecond, remaining)
                            for (let i = 0; i < quota; i++) {
                                const key = slowResubQueueRef.current.shift()
                                if (!key) break
                                const [pair, token, chain] = key.split('|')
                                try {
                                    ws.send(JSON.stringify(buildPairSlowSubscriptionSafe({ pair, token, chain })))
                                    ws.send(JSON.stringify(buildPairStatsSlowSubscriptionSafe({ pair, token, chain })))
                                } catch (err) {
                                    console.error(`[TokensPane:${title}] resubscribe slow failed for`, key, String(err))
                                }
                            }
                        }

                        // Debounced start: wait 1000ms after scroll stop before beginning slow re-subscriptions.
                        slowResubStartTimeoutRef.current = window.setTimeout(() => {
                            // run first batch at t=+1s, then continue once per second
                            tick()
                            slowResubIntervalRef.current = window.setInterval(tick, 1000)
                        }, 1000)
                    }
                    // Update tracking sets
                    visibleKeysRef.current = new Set(visKeys)
                    slowKeysRef.current = new Set(slowKeys)
                }}
            />
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingMore && <div className="status">Loading more…</div>}
            {!hasMore && <div className="status muted" style={{ fontSize: 12 }}>No more results</div>}
        </div>
    )
}
