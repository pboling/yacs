import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import Row from './Row'
import SortHeader, { type SortKey as HeaderSortKey } from './SortHeader'

// Typed helper to find the last index matching a predicate (avoids using Array.prototype.findLastIndex for broader TS lib support)
function findLastIndexSafe<T>(arr: T[], predicate: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}

// Shared Token type
import type { Token as TokenRow } from '../models/Token'

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
  onContainerRef,
  onOpenRowDetails,
  onToggleRowSubscription,
}: {
  title: string
  rows: TokenRow[]
  loading: boolean
  error: string | null
  onSort: (k: HeaderSortKey) => void
  sortKey: HeaderSortKey
  sortDir: 'asc' | 'desc'
  onRowVisibilityChange?: (row: TokenRow, visible: boolean) => void
  onScrollStart?: () => void
  onScrollStop?: (visibleRows: TokenRow[]) => void
  getRowStatus?: (
    row: TokenRow,
  ) => { state: 'subscribed' | 'unsubscribed' | 'disabled'; tooltip?: string } | undefined
  onBothEndsVisible?: (v: boolean) => void
  onContainerRef?: (el: HTMLDivElement | null) => void
  onOpenRowDetails?: (row: TokenRow) => void
  onToggleRowSubscription?: (row: TokenRow) => void
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
    } catch {
      /* no-op */
    }
  }, [rows, title])

  // Dev-only: diff logging to prove which rows actually changed between renders
  useEffect(() => {
    if (!import.meta.env.DEV) return
    try {
      interface Snap {
        price: number
        mcap: number
        vol: number
        buys: number
        sells: number
        liq: number
      }
      const tableAny = Table as unknown as { __prevMaps__?: Record<string, Record<string, Snap>> }
      const maps: Record<string, Record<string, Snap>> = tableAny.__prevMaps__ ?? {}
      const prevMap: Partial<Record<string, Snap>> = maps[title] ?? {}
      const nextMap: Record<string, Snap> = {}
      const changes: { id: string; old?: Snap; new: Snap }[] = []
      for (const r of rows) {
        const snap: Snap = {
          price: r.priceUsd,
          mcap: r.mcap,
          vol: r.volumeUsd,
          buys: r.transactions.buys,
          sells: r.transactions.sells,
          liq: r.liquidity.current,
        }
        const suffix =
          title === 'Trending Tokens'
            ? 'TREND'
            : title === 'New Tokens'
              ? 'NEW'
              : title.replace(/\s+/g, '-').toUpperCase()
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
      ;(Table as unknown as { __prevMaps__?: Record<string, Record<string, Snap>> }).__prevMaps__ =
        { ...maps, [title]: nextMap }
      if (changes.length > 0) {
        const c = changes[0]
        console.log(`[Table:${title}] changed ${String(changes.length)} rows; first change`, c)
      }
    } catch {
      /* no-op */
    }
  }, [rows, title])

  // Export helpers
  const exportFormatOptions = ['csv', 'json'] as const
  type ExportFormat = (typeof exportFormatOptions)[number]
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
    const obs = new IntersectionObserver(cb, {
      root: rootEl ?? null,
      rootMargin: '100px 0px',
      threshold: 0,
    })
    observerRef.current = obs
    // Observe any rows already registered
    for (const el of rowMapRef.current.keys()) {
      try {
        obs.observe(el)
      } catch {
        /* ignore observe errors */
      }
    }
    // Proactively compute currently visible rows once to seed visibility and subscriptions
    try {
      const vis: { el: Element; row: TokenRow }[] = []
      const contRect = rootEl?.getBoundingClientRect()
      if (contRect) {
        const ordered: { el: Element; row: TokenRow }[] = []
        for (const [el, row] of rowMapRef.current.entries()) {
          ordered.push({ el, row })
          const r = el.getBoundingClientRect()
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
          const firstIdx = ordered.findIndex((o) => o.el === vis[0].el)
          const lastIdx = findLastIndexSafe(ordered, (o) => o.el === vis[vis.length - 1].el)
          const start = Math.max(0, Math.min(firstIdx, lastIdx) - 3)
          const end = Math.min(ordered.length - 1, Math.max(firstIdx, lastIdx) + 3)
          for (let i = start; i <= end; i++) indices.add(i)
          return Array.from(indices)
            .sort((a, b) => a - b)
            .map((i) => ordered[i].row)
        })()
        // Notify visibility changes for actually intersecting ones
        for (const { row } of vis) {
          try {
            onRowVisibilityChange?.(row, true)
          } catch {
            /* no-op */
          }
        }
        // Fire a synthetic scroll stop with expanded rows
        if (onScrollStop) {
          try {
            onScrollStop(expandedRows)
          } catch {
            /* no-op */
          }
        }
      }
    } catch {
      /* no-op */
    }
    return () => {
      try {
        obs.disconnect()
      } catch {
        /* ignore disconnect errors */
      }
    }
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
        const disable = !anyRowVisible || (firstRowVisible && footVis)
        onBothEndsVisible(disable)
      } catch {
        /* no-op */
      }
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
    try {
      obs.observe(foot)
    } catch {
      /* no-op */
    }
    // initial compute
    try {
      const contRect = root.getBoundingClientRect()
      const f = foot.getBoundingClientRect()
      footVis = f.bottom >= contRect.top && f.top <= contRect.bottom
      computeAndNotify()
    } catch {
      /* no-op */
    }

    // Also listen to scroll events to recompute row visibility driven condition
    const onScroll = () => {
      computeAndNotify()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      try {
        obs.disconnect()
      } catch {
        /* no-op */
      }
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
        try {
          onScrollStart?.()
        } catch {
          /* no-op */
        }
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
        } catch {
          /* no-op */
        }
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
          try {
            obs?.unobserve(k)
          } catch {
            /* ignore unobserve errors */
          }
          map.delete(k)
        }
      }
      return
    }
    map.set(el, row)
    try {
      obs?.observe(el)
    } catch {
      /* ignore observe errors */
    }
  }

  // State for burn tooltip hover
  const [showBurnTooltipIdx, setShowBurnTooltipIdx] = useState<number | null>(null)

  // Stable ref-callback to register/unregister a row element with the IntersectionObserver
  const registerRowCb = useCallback((el: HTMLTableRowElement | null, row: TokenRow) => {
    const obs = observerRef.current
    const map = rowMapRef.current
    if (!el) {
      for (const [k, v] of map.entries()) {
        if (v === row) {
          try {
            obs?.unobserve(k)
          } catch {}
          map.delete(k)
        }
      }
      return
    }
    map.set(el, row)
    try {
      obs?.observe(el)
    } catch {}
  }, [])

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0 }}>
          {title}
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
            {rows.length} rows
          </span>
        </h2>
        <div className="export-controls" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="muted" style={{ fontSize: 12 }}>
            Format
            <select
              aria-label={`Select ${title} export format`}
              value={exportFormat}
              onChange={(e) => {
                setExportFormat(e.currentTarget.value as ExportFormat)
              }}
              style={{ marginLeft: 6 }}
            >
              {exportFormatOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onExport}
            title={`Export ${String(rows.length)} rows`}
            disabled={rows.length === 0}
          >
            Export
          </button>
        </div>

        {loading && <div className="status">Loading…</div>}
        {error && <div className="status error">{error}</div>}
        {!loading && !error && rows.length === 0 && <div className="status">No data</div>}
        <div
          ref={(el) => {
            containerRef.current = el
            try {
              onContainerRef?.(el)
            } catch {
              /* no-op */
            }
          }}
          className="table-wrap"
          style={{ width: '100%' }}
        >
          <table className="tokens">
            <thead ref={theadRef}>
              <tr>
                <SortHeader
                  label="Token"
                  k="tokenName"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Exchange"
                  k="exchange"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  style={{ width: 30, minWidth: 30, maxWidth: 30 }}
                />
                <SortHeader
                  label="Price"
                  k="priceUsd"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="MCap"
                  k="mcap"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Volume"
                  k="volumeUsd"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <th>
                  Chg (5m/1h
                  <br />
                  6h/24h)
                </th>
                <SortHeader
                  label="Age"
                  k="age"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Buys/Sells"
                  k="tx"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortHeader
                  label="Liquidity"
                  k="liquidity"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, idx) => {
                const suffix =
                  title === 'Trending Tokens'
                    ? 'TREND'
                    : title === 'New Tokens'
                      ? 'NEW'
                      : title.replace(/\s+/g, '-').toUpperCase()
                const composedId = `${t.id}::${suffix}`
                return (
                  <Row
                    key={composedId}
                    row={t}
                    idx={idx}
                    rowsLen={rows.length}
                    composedId={composedId}
                    getRowStatus={getRowStatus}
                    onOpenRowDetails={onOpenRowDetails}
                    onToggleRowSubscription={onToggleRowSubscription}
                    showBurnTooltipIdx={showBurnTooltipIdx}
                    setShowBurnTooltipIdx={setShowBurnTooltipIdx}
                    registerRow={registerRowCb}
                  />
                )
              })}
            </tbody>
            <tfoot ref={tfootRef}>
              <tr>
                <td
                  colSpan={10}
                  className="muted"
                  style={{ fontSize: 12, textAlign: 'right', padding: '6px 8px' }}
                >
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
