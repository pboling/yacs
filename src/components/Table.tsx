import NumberCell from './NumberCell'
import AuditIcons from './AuditIcons'
import { useEffect, useMemo, useState, useRef } from 'react'
import { Globe, MessageCircle, Send, ExternalLink, Eye, PauseCircle, Timer, Snail } from 'lucide-react'

// Typed helper to find the last index matching a predicate (avoids using Array.prototype.findLastIndex for broader TS lib support)
function findLastIndexSafe<T>(arr: T[], predicate: (v: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return i
    }
    return -1
}

// Local minimal types to avoid circular deps with App
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
    audit?: { contractVerified?: boolean; freezable?: boolean; honeypot?: boolean; linkDiscord?: string; linkTelegram?: string; linkTwitter?: string; linkWebsite?: string }
    security?: { renounced?: boolean; locked?: boolean; burned?: boolean }
}

type SortKey = 'tokenName' | 'exchange' | 'priceUsd' | 'mcap' | 'volumeUsd' | 'age' | 'tx' | 'liquidity'

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

function ellipsed(input: string, length = 5) {
    if (typeof input !== 'string') return ''
    if (length <= 0) return ''
    if (input.length <= length) return input
    // Use a single Unicode ellipsis character for compact display
    return input.slice(0, Math.max(1, length - 1)) + '…'
}

export default function Table({
                                   title,
                                   rows,
                                   loading,
                                   error,
                                   onSort,
                                   sortKey,
                                   sortDir,
                                   onRowVisibilityChange,
                                   onScrollStart,
                                   onScrollStop,
                                   getRowStatus,
                                   onBothEndsVisible,
                               }: {
    title: string
    rows: TokenRow[]
    loading: boolean
    error: string | null
    onSort: (k: SortKey) => void
    sortKey: SortKey
    sortDir: 'asc' | 'desc'
    onRowVisibilityChange?: (row: TokenRow, visible: boolean) => void
    onScrollStart?: () => void
    onScrollStop?: (visibleRows: TokenRow[]) => void
    getRowStatus?: (row: TokenRow) => { state: 'fast' | 'unsubscribed' | 'queued-slow' | 'slow'; tooltip?: string } | undefined
    onBothEndsVisible?: (v: boolean) => void
}) {
    // Dev-only: log a compact snapshot of the first row whenever rows change
    useEffect(() => {
        if (!import.meta.env.DEV) return
        try {
            if (rows.length > 0) {
                const t = rows[0]
                console.log(`[Table:${title}] first row`, {
                    id: t.id,
                    price: t.priceUsd,
                    mcap: t.mcap,
                    vol: t.volumeUsd,
                    buys: t.transactions.buys,
                    sells: t.transactions.sells,
                    liq: t.liquidity.current,
                })
            } else {
                console.log(`[Table:${title}] first row`, { none: true })
            }
        } catch { /* no-op */ }
    }, [rows, title])

    // Dev-only: diff logging to prove which rows actually changed between renders
    useEffect(() => {
        if (!import.meta.env.DEV) return
        try {
            interface Snap { price: number; mcap: number; vol: number; buys: number; sells: number; liq: number }
            const tableAny = Table as unknown as { __prevMaps__?: Record<string, Record<string, Snap>> }
            const maps: Record<string, Record<string, Snap>> = tableAny.__prevMaps__ ?? {}
            const prevMap: Partial<Record<string, Snap>> = maps[title] ?? {}
            const nextMap: Record<string, Snap> = {}
            const changes: { id: string; old?: Snap; new: Snap }[] = []
            for (const r of rows) {
                const snap: Snap = { price: r.priceUsd, mcap: r.mcap, vol: r.volumeUsd, buys: r.transactions.buys, sells: r.transactions.sells, liq: r.liquidity.current }
                const suffix = title === 'Trending Tokens' ? 'TREND' : title === 'New Tokens' ? 'NEW' : title.replace(/\s+/g, '-').toUpperCase()
                const composedId = `${r.id}::${suffix}`
                nextMap[composedId] = snap
                const prev = prevMap[composedId]
                if (
                    !prev ||
                    prev.price !== snap.price ||
                    prev.mcap !== snap.mcap ||
                    prev.vol !== snap.vol ||
                    prev.buys !== snap.buys ||
                    prev.sells !== snap.sells ||
                    prev.liq !== snap.liq
                ) {
                    changes.push({ id: r.id, old: prev, new: snap })
                }
            }
            ;(Table as unknown as { __prevMaps__?: Record<string, Record<string, Snap>> }).__prevMaps__ = { ...maps, [title]: nextMap }
            if (changes.length > 0) {
                const c = changes[0]
                console.log(`[Table:${title}] changed ${String(changes.length)} rows; first change`, c)
            }
        } catch { /* no-op */ }
    }, [rows, title])

    // Export helpers
    const exportFormatOptions = ['csv', 'json'] as const
    type ExportFormat = typeof exportFormatOptions[number]
    const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')

    const dataForExport = useMemo(() => {
        // Shape data similar to visible columns
        return rows.map((t) => ({
            id: t.id,
            tokenName: t.tokenName,
            tokenSymbol: t.tokenSymbol,
            chain: t.chain,
            exchange: t.exchange,
            priceUsd: t.priceUsd,
            mcap: t.mcap,
            volumeUsd: t.volumeUsd,
            chg5m: t.priceChangePcs['5m'],
            chg1h: t.priceChangePcs['1h'],
            chg6h: t.priceChangePcs['6h'],
            chg24h: t.priceChangePcs['24h'],
            tokenCreatedTimestamp: t.tokenCreatedTimestamp.toISOString(),
            buys: t.transactions.buys,
            sells: t.transactions.sells,
            liquidity: t.liquidity.current,
        }))
    }, [rows])

    function toCsv(objs: Record<string, unknown>[]) {
        if (objs.length === 0) return ''
        const headers = Object.keys(objs[0])
        const escape = (val: unknown) => {
            if (val == null) return ''
            let s: string
            if (typeof val === 'string') s = val
            else if (typeof val === 'number' || typeof val === 'boolean') s = String(val)
            else if (val instanceof Date) s = val.toISOString()
            else s = JSON.stringify(val)
            // Quote if contains comma, quote or newline
            if (/[",\n]/.test(s)) {
                return '"' + s.replace(/"/g, '""') + '"'
            }
            return s
        }
        const lines = [headers.join(',')]
        for (const row of objs) {
            const r: Record<string, unknown> = row
            lines.push(headers.map((h) => escape(r[h])).join(','))
        }
        return lines.join('\n')
    }

    function download(content: string, filename: string, mime: string) {
        const blob = new Blob([content], { type: mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        }, 0)
    }

    function onExport() {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const base = title.replace(/\s+/g, '_').toLowerCase()
        if (exportFormat === 'json') {
            const json = JSON.stringify(dataForExport, null, 2)
            download(json, `${base}_${ts}.json`, 'application/json')
        } else {
            const csv = toCsv(dataForExport as Record<string, unknown>[])
            download(csv, `${base}_${ts}.csv`, 'text/csv')
        }
    }

    // IntersectionObserver for row visibility
    const observerRef = useRef<IntersectionObserver | null>(null)
    const rowMapRef = useRef<Map<Element, TokenRow>>(new Map())
    const visibleElsRef = useRef<Set<Element>>(new Set())
    // Scroll container ref (overflow: auto)
    const containerRef = useRef<HTMLDivElement | null>(null)
    // Header/Footer refs for viewport-span detection
    const theadRef = useRef<HTMLTableSectionElement | null>(null)
    const tfootRef = useRef<HTMLTableSectionElement | null>(null)

    useEffect(() => {
        const rootEl = containerRef.current
        const cb: IntersectionObserverCallback = (entries) => {
            for (const e of entries) {
                const row = rowMapRef.current.get(e.target)
                if (!row) continue
                const visible = e.isIntersecting || e.intersectionRatio > 0
                if (visible) visibleElsRef.current.add(e.target)
                else visibleElsRef.current.delete(e.target)
                if (onRowVisibilityChange) onRowVisibilityChange(row, visible)
            }
        }
        const obs = new IntersectionObserver(cb, { root: rootEl ?? null, rootMargin: '100px 0px', threshold: 0 })
        observerRef.current = obs
        // Observe any rows already registered
        for (const el of rowMapRef.current.keys()) {
            try { obs.observe(el) } catch { /* ignore observe errors */ }
        }
        // Proactively compute currently visible rows once to seed visibility and fast subscriptions
        try {
            const vis: { el: Element; row: TokenRow }[] = []
            const contRect = rootEl?.getBoundingClientRect()
            if (contRect) {
                const ordered: { el: Element; row: TokenRow }[] = []
                for (const [el, row] of rowMapRef.current.entries()) {
                    ordered.push({ el, row })
                    const r = (el).getBoundingClientRect()
                    const intersects = r.bottom >= contRect.top && r.top <= contRect.bottom
                    if (intersects) {
                        visibleElsRef.current.add(el)
                        vis.push({ el, row })
                    } else {
                        visibleElsRef.current.delete(el)
                    }
                }
                // Expand by +/-3 around the edges of the visible block to account for estimation errors
                const expandedRows: TokenRow[] = (() => {
                    if (vis.length === 0) return []
                    const indices = new Set<number>()
                    const firstIdx = ordered.findIndex(o => o.el === vis[0].el)
                    const lastIdx = findLastIndexSafe(ordered, (o) => o.el === vis[vis.length - 1].el)
                    const start = Math.max(0, Math.min(firstIdx, lastIdx) - 3)
                    const end = Math.min(ordered.length - 1, Math.max(firstIdx, lastIdx) + 3)
                    for (let i = start; i <= end; i++) indices.add(i)
                    return Array.from(indices).sort((a, b) => a - b).map(i => ordered[i].row)
                })()
                // Notify visibility changes for actually intersecting ones
                for (const { row } of vis) {
                    try { onRowVisibilityChange?.(row, true) } catch { /* no-op */ }
                }
                // Fire a synthetic scroll stop with expanded rows
                if (onScrollStop) {
                    try { onScrollStop(expandedRows) } catch { /* no-op */ }
                }
            }
        } catch { /* no-op */ }
        return () => { try { obs.disconnect() } catch { /* ignore disconnect errors */ } }
    }, [onRowVisibilityChange, onScrollStop])

    // Determine when to disable infinite scroll based on viewport state
    // Disable when:
    //  - No data rows are currently in view, OR
    //  - The first row at the top of the table AND the <tfoot> are both visible.
    useEffect(() => {
        if (!onBothEndsVisible) return
        const root = containerRef.current
        const head = theadRef.current
        const foot = tfootRef.current
        if (!root || !head || !foot) return
        let footVis = false

        const computeAndNotify = () => {
            try {
                // Is any row visible?
                const anyRowVisible = visibleElsRef.current.size > 0
                // Is the first row visible?
                let firstRowVisible = false
                if (rows.length > 0) {
                    const first = rows[0]
                    for (const [el, row] of rowMapRef.current.entries()) {
                        if (row === first) {
                            firstRowVisible = visibleElsRef.current.has(el)
                            break
                        }
                    }
                }
                const disable = (!anyRowVisible) || (firstRowVisible && footVis)
                onBothEndsVisible(disable)
            } catch { /* no-op */ }
        }

        const cb: IntersectionObserverCallback = (entries) => {
            for (const e of entries) {
                if (e.target === foot) {
                    footVis = e.isIntersecting || e.intersectionRatio > 0
                }
            }
            computeAndNotify()
        }
        const obs = new IntersectionObserver(cb, { root, threshold: 0 })
        try { obs.observe(foot) } catch { /* no-op */ }
        // initial compute
        try {
            const contRect = root.getBoundingClientRect()
            const f = foot.getBoundingClientRect()
            footVis = f.bottom >= contRect.top && f.top <= contRect.bottom
            computeAndNotify()
        } catch { /* no-op */ }

        // Also listen to scroll events to recompute row visibility driven condition
        const onScroll = () => { computeAndNotify() }
        window.addEventListener('scroll', onScroll, { passive: true })
        root.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            try { obs.disconnect() } catch { /* no-op */ }
            window.removeEventListener('scroll', onScroll)
            root.removeEventListener('scroll', onScroll)
        }
    }, [rows, onBothEndsVisible])

    // Scroll start/stop detection to coordinate subscriptions during scroll
    const isScrollingRef = useRef(false)
    const stopTimerRef = useRef<number | null>(null)

    useEffect(() => {
        const handleScrollOrWheel = () => {
            // start
            if (!isScrollingRef.current) {
                isScrollingRef.current = true
                try { onScrollStart?.() } catch { /* no-op */ }
            }
            // debounce stop
            if (stopTimerRef.current != null) {
                window.clearTimeout(stopTimerRef.current)
                stopTimerRef.current = null
            }
            stopTimerRef.current = window.setTimeout(() => {
                isScrollingRef.current = false
                try {
                    if (onScrollStop) {
                        // Build ordered list of rows and expand visibility by +/-3 indices around edges
                        const ordered: { el: Element; row: TokenRow }[] = []
                        for (const [el, row] of rowMapRef.current.entries()) ordered.push({ el, row })
                        const visibleIdxs: number[] = []
                        for (let i = 0; i < ordered.length; i++) {
                            if (visibleElsRef.current.has(ordered[i].el)) visibleIdxs.push(i)
                        }
                        const expanded: TokenRow[] = []
                        if (visibleIdxs.length > 0) {
                            const start = Math.max(0, Math.min(...visibleIdxs) - 3)
                            const end = Math.min(ordered.length - 1, Math.max(...visibleIdxs) + 3)
                            for (let i = start; i <= end; i++) expanded.push(ordered[i].row)
                        }
                        onScrollStop(expanded)
                    }
                } catch { /* no-op */ }
            }, 200)
        }
        const win = window
        const cont = containerRef.current
        win.addEventListener('scroll', handleScrollOrWheel, { passive: true })
        win.addEventListener('wheel', handleScrollOrWheel, { passive: true })
        cont?.addEventListener('scroll', handleScrollOrWheel, { passive: true })
        cont?.addEventListener('wheel', handleScrollOrWheel, { passive: true })
        return () => {
            win.removeEventListener('scroll', handleScrollOrWheel)
            win.removeEventListener('wheel', handleScrollOrWheel)
            cont?.removeEventListener('scroll', handleScrollOrWheel)
            cont?.removeEventListener('wheel', handleScrollOrWheel)
            if (stopTimerRef.current != null) window.clearTimeout(stopTimerRef.current)
        }
    }, [onScrollStart, onScrollStop])

    function registerRow(el: HTMLTableRowElement | null, row: TokenRow) {
        const obs = observerRef.current
        const map = rowMapRef.current
        if (!el) {
            // unobserve
            for (const [k, v] of map.entries()) {
                if (v === row) {
                    try { obs?.unobserve(k) } catch { /* ignore unobserve errors */ }
                    map.delete(k)
                }
            }
            return
        }
        map.set(el, row)
        try { obs?.observe(el) } catch { /* ignore observe errors */ }
    }

    return (
        <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{title}</h2>
                <div className="export-controls" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label className="muted" style={{ fontSize: 12 }}>
                        Format
                        <select
                            aria-label={`Select ${title} export format`}
                            value={exportFormat}
                            onChange={(e) => { setExportFormat(e.currentTarget.value as ExportFormat) }}
                            style={{ marginLeft: 6 }}
                        >
                            {exportFormatOptions.map((opt) => (
                                <option key={opt} value={opt}>{opt.toUpperCase()}</option>
                            ))}
                        </select>
                    </label>
                    <button type="button" onClick={onExport} title={`Export ${String(rows.length)} rows`} disabled={rows.length === 0}>Export</button>
                </div>

                {loading && <div className="status">Loading…</div>}
                {error && <div className="status error">{error}</div>}
                {!loading && !error && rows.length === 0 && <div className="status">No data</div>}
                <div ref={containerRef} className="table-wrap" style={{ width: '100%' }}>
                    <table className="tokens">
                        <thead ref={theadRef}>
                        <tr>
                            <th onClick={() => { onSort('tokenName') }}
                                aria-sort={sortKey === 'tokenName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Token
                            </th>
                            <th onClick={() => { onSort('exchange') }}
                                aria-sort={sortKey === 'exchange' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Exchange
                            </th>
                            <th onClick={() => { onSort('priceUsd') }}
                                aria-sort={sortKey === 'priceUsd' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Price
                            </th>
                            <th onClick={() => { onSort('mcap') }}
                                aria-sort={sortKey === 'mcap' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>MCap
                            </th>
                            <th onClick={() => { onSort('volumeUsd') }}
                                aria-sort={sortKey === 'volumeUsd' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Volume
                            </th>
                            <th>Chg (5m/1h/6h/24h)</th>
                            <th onClick={() => { onSort('age') }}
                                aria-sort={sortKey === 'age' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Age
                            </th>
                            <th onClick={() => { onSort('tx') }}
                                aria-sort={sortKey === 'tx' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Buys/Sells
                            </th>
                            <th onClick={() => { onSort('liquidity') }}
                                aria-sort={sortKey === 'liquidity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>Liquidity
                            </th>
                            <th>Audit</th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((t) => {
                            const suffix = title === 'Trending Tokens' ? 'TREND' : title === 'New Tokens' ? 'NEW' : title.replace(/\s+/g, '-').toUpperCase()
                            const composedId = `${t.id}::${suffix}`
                            return (
                                <tr key={composedId} data-row-id={composedId} ref={(el) => { registerRow(el, t) }}>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {(() => {
                                                    const s = getRowStatus?.(t)
                                                    if (!s) return null
                                                    const size = 14
                                                    const color = s.state === 'fast' ? '#16a34a' : s.state === 'slow' ? '#6b7280' : s.state === 'queued-slow' ? '#f59e0b' : '#9ca3af'
                                                    const title = s.tooltip ?? ''
                                                    if (s.state === 'fast') return (
                                                        <span title={title} aria-label="Subscribed (fast)" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                            <Eye size={size} color={color} />
                                                        </span>
                                                    )
                                                    if (s.state === 'slow') return (
                                                        <span title={title} aria-label="Subscribed (slow)" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                            <Snail size={size} color={color} />
                                                        </span>
                                                    )
                                                    if (s.state === 'queued-slow') return (
                                                        <span title={title} aria-label="Queued for slow subscription" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                            <Timer size={size} color={color} />
                                                        </span>
                                                    )
                                                    return (
                                                        <span title={title} aria-label="Unsubscribed during scroll" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                            <PauseCircle size={size} color={color} />
                                                        </span>
                                                    )
                                                })()}
                                                <strong title={`${t.tokenName}/${t.tokenSymbol}/${t.chain}`}>{`${ellipsed(t.tokenName + '/' + t.tokenSymbol, 6)}/${t.chain}`}</strong>
                                            </div>
                                            {(() => {
                                                const { linkWebsite, linkTwitter, linkTelegram, linkDiscord } = t.audit ?? {}
                                                const hasAnyLink = [linkWebsite, linkTwitter, linkTelegram, linkDiscord].some(Boolean)
                                                if (!hasAnyLink) return null
                                                return (
                                                    <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                                                        {linkWebsite && (
                                                            <a href={linkWebsite} target="_blank" rel="noopener noreferrer" title="Website" aria-label="Website" style={{ color: 'inherit' }}>
                                                                <Globe size={14} />
                                                            </a>
                                                        )}
                                                        {linkTwitter && (
                                                            <a href={linkTwitter} target="_blank" rel="noopener noreferrer" title="Twitter" aria-label="Twitter" style={{ color: 'inherit' }}>
                                                                <ExternalLink size={14} />
                                                            </a>
                                                        )}
                                                        {linkTelegram && (
                                                            <a href={linkTelegram} target="_blank" rel="noopener noreferrer" title="Telegram" aria-label="Telegram" style={{ color: 'inherit' }}>
                                                                <Send size={14} />
                                                            </a>
                                                        )}
                                                        {linkDiscord && (
                                                            <a href={linkDiscord} target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord" style={{ color: 'inherit' }}>
                                                                <MessageCircle size={14} />
                                                            </a>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </div>
                                    </td>
                                    <td>{t.exchange}</td>
                                    <td>
                                        <NumberCell value={t.priceUsd} prefix="$" formatter={(n) => n.toFixed(8)} />
                                    </td>
                                    <td>
                                        <NumberCell value={t.mcap} prefix="$" formatter={(n) => Math.round(n).toLocaleString()} />
                                    </td>
                                    <td>
                                        <NumberCell value={t.volumeUsd} prefix="$" formatter={(n) => Math.round(n).toLocaleString()} />
                                    </td>
                                    <td>
                                        <NumberCell noFade value={t.priceChangePcs['5m']} suffix="%" />{' / '}
                                        <NumberCell noFade value={t.priceChangePcs['1h']} suffix="%" />{' / '}
                                        <NumberCell noFade value={t.priceChangePcs['6h']} suffix="%" />{' / '}
                                        <NumberCell noFade value={t.priceChangePcs['24h']} suffix="%" />
                                    </td>
                                    <td>{formatAge(t.tokenCreatedTimestamp)}</td>
                                    <td>
                                        <NumberCell value={t.transactions.buys} />/<NumberCell value={t.transactions.sells} />
                                    </td>
                                    <td>
                                        <NumberCell value={t.liquidity.current} prefix="$" formatter={(n) => Math.round(n).toLocaleString()} />
                                    </td>
                                    <td>
                                        <AuditIcons flags={{
                                            verified: t.audit?.contractVerified,
                                            freezable: t.audit?.freezable,
                                            renounced: t.security?.renounced,
                                            locked: t.security?.locked,
                                            burned: t.security?.burned,
                                            honeypot: t.audit?.honeypot,
                                        }} />
                                    </td>
                                </tr>
                            )
                        })}
                        </tbody>
                        <tfoot ref={tfootRef}>
                        <tr>
                            <td colSpan={10} className="muted" style={{ fontSize: 12, textAlign: 'right', padding: '6px 8px' }}>
                                Rows (non-hidden): <strong>{rows.length}</strong>
                            </td>
                        </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </section>
    )
}
