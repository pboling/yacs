import { useEffect, useMemo, useRef, useState } from 'react'
import Table from './Table'
import { fetchScanner } from '../scanner.client.js'
import { buildPairStatsSubscription, buildPairSubscription } from '../ws.mapper.js'
import { computePairPayloads } from '../ws.subs.js'
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
    audit?: { honeypot?: boolean }
    // Optional fields present in reducer mapping; used to form WS subscription payloads when rows render
    pairAddress?: string
    tokenAddress?: string
}

// Action aliases to satisfy TS strictly
interface ScannerPairsAction { type: 'scanner/pairs'; payload: { page: number; scannerPairs: unknown[] } }

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
                                    }: {
    title: string
    filters: GetScannerResultParams
    page: number
    state: { byId: Record<string, TokenRow | undefined>, pages: Partial<Record<number, string[]>> } & { version?: number }
    dispatch: React.Dispatch<ScannerPairsAction>
    defaultSort: { key: SortKey; dir: Dir }
    clientFilters?: { chains?: string[]; minVolume?: number; maxAgeHours?: number | null; minMcap?: number; excludeHoneypots?: boolean }
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sort, setSort] = useState(defaultSort)
    const wsRef = useRef<WebSocket | null>(null)
    const payloadsRef = useRef<{ pair: string; token: string; chain: string }[]>([])
    const rowsRef = useRef<TokenRow[]>([])

    // Fetch function as typed alias to keep TS happy with JS module
    const fetchScannerTyped = fetchScanner as unknown as (p: GetScannerResultParams) => Promise<{ raw: { page?: number | null; scannerPairs?: ScannerResult[] | null } }>
    const buildPairSubscriptionSafe = buildPairSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair'; data: { pair: string; token: string; chain: string } }
    const buildPairStatsSubscriptionSafe = buildPairStatsSubscription as unknown as (p: { pair: string; token: string; chain: string }) => { event: 'subscribe-pair-stats'; data: { pair: string; token: string; chain: string } }
    const computePairPayloadsSafe = computePairPayloads as unknown as (items: ScannerResult[] | unknown[]) => { pair: string; token: string; chain: string }[]

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
                // If we already computed payloads and socket is OPEN, (re)send subscriptions now
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        if (payloadsRef.current.length > 0) {
                            console.log('[TokensPane:' + title + '] sending ' + String(payloadsRef.current.length) + ' pair subscriptions on late WS attach')
                            for (const p of payloadsRef.current) {
                                ws.send(JSON.stringify(buildPairSubscriptionSafe(p)))
                                ws.send(JSON.stringify(buildPairStatsSubscriptionSafe(p)))
                            }
                        }
                        // Also ensure visible-row subscriptions on late attach
                        const seen = new Set<string>()
                        const anyRows = Array.isArray(rowsRef.current) ? rowsRef.current : []
                        for (const t of anyRows) {
                            const pair = t.pairAddress
                            const token = t.tokenAddress
                            if (!pair || !token) continue
                            const chain = t.chain
                            const key = pair + '|' + token + '|' + chain
                            if (seen.has(key)) continue
                            seen.add(key)
                            ws.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                            ws.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
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
        const run = async () => {
            setLoading(true)
            setError(null)
            try {
                console.log('[TokensPane:' + title + '] fetching initial scanner page with filters', { ...filters, page })
                const res = await fetchScannerTyped({ ...filters, page })
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
                // Subscribe per-pair if WS is already open
                const ws = wsRef.current
                const rs = ws?.readyState
                console.log('[TokensPane:' + title + '] WS readyState at subscription time: ' + String(rs))
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        console.log('[TokensPane:' + title + '] sending ' + String(payloads.length) + ' pair subscriptions (immediate)')
                        for (const p of payloads) {
                            ws.send(JSON.stringify(buildPairSubscriptionSafe(p)))
                            ws.send(JSON.stringify(buildPairStatsSubscriptionSafe(p)))
                        }
                    } catch (err) {
                        console.error(`[TokensPane:${title}] failed to send immediate subscriptions`, err)
                    }
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load data'
                console.error('[TokensPane:' + title + '] fetch failed', e)
                if (!cancelled) setError(msg)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        void run()
        return () => { cancelled = true }
    }, [filters, dispatch, fetchScannerTyped, computePairPayloadsSafe, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, page, title])

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
        const selectedChains = (cf.chains && cf.chains.length > 0) ? new Set(cf.chains) : null
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
        const out = sorted.slice(0, 50)
        return out
    }, [state.byId, state.pages, page, sort, clientFilters])

    // Keep a ref of latest rows for late WS attach logic
    useEffect(() => {
        rowsRef.current = rows
    }, [rows])

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

    // Ensure per-row subscriptions for all currently visible rows (top 50) — this protects
    // against any races where App-level scanner-pairs handling didn't issue subs yet.
    useEffect(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        try {
            const sent = new Set<string>()
            for (const t of rows) {
                const pair = t.pairAddress
                const token = t.tokenAddress
                if (!pair || !token) continue // require both to avoid malformed subs
                const chain = t.chain // may be a name (ETH/BASE). Server-side is tolerant.
                const key = pair + '|' + token + '|' + chain
                if (sent.has(key)) continue
                sent.add(key)
                ws.send(JSON.stringify(buildPairSubscriptionSafe({ pair, token, chain })))
                ws.send(JSON.stringify(buildPairStatsSubscriptionSafe({ pair, token, chain })))
            }
            try { console.log(`[TokensPane:${title}] ensured subscriptions for ${String(sent.size)} visible rows`) } catch { /* no-op */ }
        } catch (err) {
            console.error(`[TokensPane:${title}] failed ensuring row subscriptions`, err)
        }
    }, [rows, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, title])

    return (
        <Table
            title={title}
            rows={rows}
            loading={loading}
            error={error}
            onSort={onSort}
            sortKey={sort.key}
            sortDir={sort.dir}
        />
    )
}
