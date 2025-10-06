/*
  Table.tsx
  Virtualized table component rendering token rows with sorting, sticky headers,
  visibility tracking, and perf-focused diff logging for development.
*/
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import Row from './Row'
import SortHeader, { type SortKey as HeaderSortKey } from './SortHeader'
import { debugLog, debugLogIf } from '../utils/debug.mjs'

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

  // Feature flag: enable virtualization by default unless ?virtual=false is in the URL
  const enableVirtual = useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const v = sp.get('virtual')
      if (v == null) return true // default ON
      return v !== 'false'
    } catch {
      return true
    }
  }, [])

  // Compute an estimated row size: ~3x line-height (rows have three lines) + padding/borders
  const [estimatedRowSize, setEstimatedRowSize] = useState<number>(66)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    try {
      const cs = window.getComputedStyle(el)
      // Try to read line-height in px; fallback to 18 if not parseable
      const lhRaw = cs.lineHeight
      const lh = Number.isFinite(parseFloat(lhRaw)) ? parseFloat(lhRaw) : 18
      // Approximate: 3 lines + vertical paddings/margins/borders (~12px)
      const est = Math.max(40, Math.round(lh * 3 + 12))
      if (Math.abs(est - estimatedRowSize) > 1) setEstimatedRowSize(est)
    } catch {
      /* no-op */
    }
  }, [containerRef, estimatedRowSize])

  // Virtualizer for rows: only render what is visible to drastically reduce DOM nodes
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => estimatedRowSize,
    overscan: 8,
  })

  useEffect(() => {
    const rootEl = containerRef.current
    const cb: IntersectionObserverCallback = (entries) => {
      for (const e of entries) {
        const row = rowMapRef.current.get(e.target)
        if (!row) continue
        const visible = e.isIntersecting || e.intersectionRatio > 0
        if (visible) visibleElsRef.current.add(e.target)
        else visibleElsRef.current.delete(e.target)
        try {
          const el = e.target as HTMLElement
          if (visible) el.setAttribute('data-visible', '1')
          else el.removeAttribute('data-visible')
          // Notify the row element directly so it can gate animations without new props
          const evt = new CustomEvent('dex:row-visibility', { detail: { visible } })
          el.dispatchEvent(evt)
          // Diagnostics (debug only): log each visibility entry with geometry
          debugLogIf(() => {
            const r = el.getBoundingClientRect()
            const rootBounds = (e.rootBounds as DOMRect | null) ?? null
            debugLog(`[Table:${title}] IO entry`, {
              rowId: row.id,
              visible,
              ratio: e.intersectionRatio,
              time: new Date().toISOString(),
              rect: { top: r.top, bottom: r.bottom, height: r.height },
              root: rootBounds
                ? { top: rootBounds.top, bottom: rootBounds.bottom, height: rootBounds.height }
                : null,
            })
          })
        } catch {
          /* no-op */
        }
        if (onRowVisibilityChange) onRowVisibilityChange(row, visible)
      }
    }
    const obs = new IntersectionObserver(cb, {
      root: rootEl ?? null,
      rootMargin: '100px 0px',
      threshold: 0,
    })
    debugLogIf(() => {
      const rootRect = rootEl?.getBoundingClientRect() ?? null
      debugLog(`[Table:${title}] IO created`, {
        rootMargin: '100px 0px',
        threshold: 0,
        rootRect: rootRect
          ? { top: rootRect.top, bottom: rootRect.bottom, height: rootRect.height }
          : null,
        time: new Date().toISOString(),
      })
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
            try {
              ;(el as HTMLElement).setAttribute('data-visible', '1')
              const evt = new CustomEvent('dex:row-visibility', { detail: { visible: true } })
              el.dispatchEvent(evt)
            } catch {}
            vis.push({ el, row })
          } else {
            visibleElsRef.current.delete(el)
            try {
              ;(el as HTMLElement).removeAttribute('data-visible')
              const evt = new CustomEvent('dex:row-visibility', { detail: { visible: false } })
              el.dispatchEvent(evt)
            } catch {}
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
            debugLogIf(() => {
              const sample = expandedRows.slice(0, 5).map((r) => r.id)
              debugLog(`[Table:${title}] onScrollStop(seed)`, {
                count: expandedRows.length,
                sample,
                time: new Date().toISOString(),
              })
            })
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
  }, [onRowVisibilityChange, onScrollStop, title])

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
            debugLog(`[Table:${title}] onScrollStop`, {
              count: expanded.length,
              sample: expanded.slice(0, 5).map((r) => r.id),
              time: new Date().toISOString(),
            })
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
  }, [onScrollStart, onScrollStop, title])

  // State for burn tooltip hover

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

  // Log when the loading spinner would be shown or hidden
  const showLoadingBanner = loading && rows.length === 0
  const prevShowRef = useRef<boolean>(showLoadingBanner)
  useEffect(() => {
    try {
      if (prevShowRef.current !== showLoadingBanner) {
        debugLog(
          `[Table:${title}] loading banner ${showLoadingBanner ? 'shown' : 'hidden'} (loading=${loading}, rows=${rows.length})`,
        )
        prevShowRef.current = showLoadingBanner
      }
    } catch {}
  }, [showLoadingBanner, loading, rows.length, title])

  // Count only actual token rows, not metadata or tr elements
  const tokenCount = rows.length
  // Expose a tiny test canary for smoke tests to verify row count without DOM traversal
  const canaryId = useMemo(() => {
    if (title === 'Trending Tokens') return 'rows-count-trending'
    if (title === 'New Tokens') return 'rows-count-new'
    return null
  }, [title])

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
            {tokenCount} tokens
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

        {loading && rows.length === 0 && (
          <div className="status loading-bump" role="status" aria-live="polite">
            <span className="loading-spinner" aria-hidden="true" />
            <span className="loading-text">Loading…</span>
          </div>
        )}
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
            {canaryId ? (
              <caption style={{ display: 'none' }}>
                <span data-testid={canaryId}>{tokenCount}</span>
              </caption>
            ) : null}
            <thead ref={theadRef}>
              <tr>
                <SortHeader
                  label="Token"
                  k="tokenName"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Token name and symbol. Click to sort alphabetically."
                  align="left"
                />
                <SortHeader
                  label="Exch."
                  k="exchange"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Exchange/DEX where the pair trades. Click to sort by exchange name."
                />
                <SortHeader
                  label="Price"
                  k="priceUsd"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Latest token price in USD (from live ticks/pair stats). Click to sort by price."
                />
                <SortHeader
                  label="MCap"
                  k="mcap"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Fully diluted or reported market cap in USD. Click to sort by market cap."
                />
                <SortHeader
                  label="Vol"
                  k="volumeUsd"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Trading volume in USD over the selected timeframe. Click to sort by volume."
                />
                <th
                  title="Price change percentages over multiple windows: 5m, 1h, 6h, 24h."
                  style={{ textAlign: 'center' }}
                >
                  5m 1h
                  <br />
                  6h 24h
                </th>
                <SortHeader
                  label="Age"
                  k="age"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Time since token creation (younger at top when sorting descending)."
                />
                <SortHeader
                  label="B/S"
                  k="tx"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Total recent transactions: buys + sells. Click to sort by activity."
                />
                <SortHeader
                  label="Liquidity"
                  k="liquidity"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  title="Current liquidity (USD) in the main pool. Click to sort by liquidity."
                />
                <SortHeader
                  label="Fresh"
                  k="fresh"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  style={{ width: 60, minWidth: 50 }}
                  title="Freshness score: recency of the latest update across scanner, live trades (tick), and pair stats. Newer data ranks higher. Click to sort by recency."
                />
                <th
                  title="Audit and safety quick checks (e.g., honeypot, verification)."
                  style={{ textAlign: 'center' }}
                >
                  Audit
                </th>
              </tr>
            </thead>
            {enableVirtual && rows.length > 50 ? (
              <tbody>
                {(() => {
                  const items = virtualizer.getVirtualItems()
                  const total = virtualizer.getTotalSize()
                  const paddingTop = items.length > 0 ? items[0].start : 0
                  const paddingBottom = items.length > 0 ? total - items[items.length - 1].end : 0
                  return (
                    <>
                      {paddingTop > 0 && (
                        <tr aria-hidden="true">
                          <td colSpan={11} style={{ padding: 0, border: 0, height: paddingTop }} />
                        </tr>
                      )}
                      {items.map((item) => {
                        const idx = item.index
                        const t = rows[idx]
                        if (!t) return null
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
                            registerRow={(el) => {
                              registerRowCb(el, t)
                            }}
                          />
                        )
                      })}
                      {paddingBottom > 0 && (
                        <tr aria-hidden="true">
                          <td
                            colSpan={11}
                            style={{ padding: 0, border: 0, height: paddingBottom }}
                          />
                        </tr>
                      )}
                    </>
                  )
                })()}
              </tbody>
            ) : (
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
                      registerRow={(el) => {
                        registerRowCb(el, t)
                      }}
                    />
                  )
                })}
              </tbody>
            )}
            <tfoot ref={tfootRef}>
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '6px 0' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    End of table
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  )
}
