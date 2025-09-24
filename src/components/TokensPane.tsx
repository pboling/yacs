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
}

// Action aliases to satisfy TS strictly
interface ScannerPairsAction { type: 'scanner/pairs'; payload: { page: number; scannerPairs: unknown[] } }

type SortKey = 'tokenName' | 'exchange' | 'priceUsd' | 'mcap' | 'volumeUsd' | 'age' | 'tx' | 'liquidity'

type Dir = 'asc' | 'desc'

export default function TokensPane({
                                       title,
                                       filters,
                                       state,
                                       dispatch,
                                       defaultSort,
                                   }: {
    title: string
    filters: GetScannerResultParams
    state: { byId: Record<string, TokenRow> }
    dispatch: React.Dispatch<ScannerPairsAction>
    defaultSort: { key: SortKey; dir: Dir }
}) {
    const [ids, setIds] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sort, setSort] = useState(defaultSort)
    const wsRef = useRef<WebSocket | null>(null)
    const payloadsRef = useRef<{ pair: string; token: string; chain: string }[]>([])

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
                if (payloadsRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
                    try {
                        console.log('[TokensPane:' + title + '] sending ' + String(payloadsRef.current.length) + ' pair subscriptions on late WS attach')
                        for (const p of payloadsRef.current) {
                            ws.send(JSON.stringify(buildPairSubscriptionSafe(p)))
                            ws.send(JSON.stringify(buildPairStatsSubscriptionSafe(p)))
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
    }, [title, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe])

    // Initial REST load (page must start at 1 for every pane)
    useEffect(() => {
        let cancelled = false
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
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (!cancelled) setError(errMsg)
                    return
                }
                const list = scannerPairs
                console.log('[TokensPane:' + title + '] /scanner returned ' + String(list.length) + ' items')
                // Update local ids for this pane only
                const payloads = computePairPayloadsSafe(list as ScannerResult[])
                payloadsRef.current = payloads
                const localIds = payloads.map((p) => p.pair)
                setIds(localIds)
                console.log('[TokensPane:' + title + '] computed ' + String(payloads.length) + ' unique pair payloads for subscriptions')
                // Merge into global store (byId/meta) — page value is irrelevant for panes
                dispatch({ type: 'scanner/pairs', payload: { page: 1, scannerPairs: list } })
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
    }, [title, filters, dispatch, fetchScannerTyped, computePairPayloadsSafe, buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe])

    // Derive rows for this pane from global byId
    const rows = useMemo(() => {
        const all = ids
            .map((id) => state.byId[id])
            .filter((t): t is TokenRow => Boolean(t))
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
        return [...all].sort(sorter(sort.key, sort.dir))
    }, [ids, state.byId, sort])

    const onSort = (k: SortKey) => {
        setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))
    }

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
