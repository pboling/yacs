import NumberCell from './NumberCell'
import AuditIcons from './AuditIcons'
import { useEffect, useMemo, useState } from 'react'

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
    audit?: { contractVerified?: boolean; freezable?: boolean; honeypot?: boolean }
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

export default function Table({
                                   title,
                                   rows,
                                   loading,
                                   error,
                                   onSort,
                                   sortKey,
                                   sortDir,
                               }: {
    title: string
    rows: TokenRow[]
    loading: boolean
    error: string | null
    onSort: (k: SortKey) => void
    sortKey: SortKey
    sortDir: 'asc' | 'desc'
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
                <div className="table-wrap" style={{ width: '100%' }}>
                    <table className="tokens">
                        <thead>
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
                                <tr key={composedId}>
                                    <td>
                                        <div>
                                            <strong>{t.tokenName}</strong> <span>({t.tokenSymbol})</span>
                                        </div>
                                        <div className="muted">{t.chain}</div>
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
                    </table>
                </div>
            </div>
        </section>
    )
}
