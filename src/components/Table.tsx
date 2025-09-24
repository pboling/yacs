import NumberCell from './NumberCell'

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
                                <td>
                                    <NumberCell value={t.priceUsd} prefix="$" formatter={(n) => n.toFixed(6)} />
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
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
