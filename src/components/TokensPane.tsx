import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Table from './Table'
import { fetchScanner } from '../scanner.client.js'
import {
  buildPairStatsSubscription,
  buildPairSubscription,
  sendSubscribe,
  sendUnsubscribe,
} from '../ws.mapper.js'
import { computePairPayloads } from '../ws.subs.js'
import { markVisible, markHidden } from '../visibility.bus.js'
import { SubscriptionQueue } from '../subscription.queue'
import { formatAge } from '../helpers/format'
import type { GetScannerResultParams, ScannerResult } from '../test-task-types'
import { buildPairKey, buildTickKey } from '../utils/key_builder'
import { dedupeByPairAddress } from '../utils/dedupeByPairAddress'
import { filterRowsByTokenQuery } from '../utils/filteredCompareOptions.mjs'
import { logCatch, debugLog } from '../utils/debug.mjs'
import {
  onSubscriptionLockChange,
  isSubscriptionLockActive,
  getSubscriptionLockAllowedKeys,
} from '../subscription.lock.bus.js'

// Use shared Token type
import type { Token as TokenRow } from '../models/Token'

// Action aliases to satisfy TS strictly
interface ScannerPairsAction {
  type: 'scanner/pairs'
  payload: { page: number; scannerPairs: unknown[] }
}
interface ScannerAppendAction {
  type: 'scanner/append'
  payload: { page: number; scannerPairs: unknown[] }
}

type SortKey =
  | 'tokenName'
  | 'exchange'
  | 'priceUsd'
  | 'mcap'
  | 'volumeUsd'
  | 'age'
  | 'tx'
  | 'liquidity'
  | 'fresh'

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
  onOpenRowDetails,
}: {
  title: string
  filters: GetScannerResultParams
  page: number
  state: {
    byId: Record<string, TokenRow | undefined>
    pages: Partial<Record<number, string[]>>
  } & { version?: number }
  dispatch: React.Dispatch<ScannerPairsAction | ScannerAppendAction>
  defaultSort: { key: SortKey; dir: Dir }
  clientFilters?: {
    chains?: string[]
    minVolume?: number
    maxAgeHours?: number | null
    minMcap?: number
    excludeHoneypots?: boolean
    limit?: number
    tokenQuery?: string
    includeStale?: boolean
    includeDegraded?: boolean
  }
  onChainCountsChange?: (counts: Record<string, number>) => void
  syncSortToUrl?: boolean
  onOpenRowDetails?: (row: TokenRow) => void
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
  // Root scroll container for the table (overflowing pane); used to scope infinite scroll
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [bothEndsVisible, setBothEndsVisible] = useState(false)

  // Disabled tokens (by token|chain), persisted to localStorage
  const disabledTokensRef = useRef<Set<string>>(new Set())
  const DISABLED_LS_KEY = 'dex.disabledTokens.v1'
  // Load disabled set on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISABLED_LS_KEY)
      if (raw) {
        const arr: unknown = JSON.parse(raw)
        if (Array.isArray(arr)) disabledTokensRef.current = new Set(arr.map(String))
      }
    } catch {
      /* no-op */
    }
  }, [])
  const persistDisabled = useCallback(() => {
    try {
      const arr = Array.from(disabledTokensRef.current)
      localStorage.setItem(DISABLED_LS_KEY, JSON.stringify(arr))
    } catch {
      /* no-op */
    }
  }, [])

  const disabledKeyFor = (row: TokenRow): string | null => {
    const token = row.tokenAddress
    if (!token) return null
    // Build token|chain key using centralized normalization
    return buildTickKey(token.toLowerCase(), row.chain)
  }

  const wsRef = useRef<WebSocket | null>(null)
  const payloadsRef = useRef<{ pair: string; token: string; chain: string }[]>([])
  const rowsRef = useRef<TokenRow[]>([])
  const scrollingRef = useRef<boolean>(false)
  // Track last update timestamps per key and previous value snapshots
  const lastUpdatedRef = useRef<Map<string, number>>(new Map())
  // Track previously rendered keys to unsubscribe when rows fall out due to limit/sort
  const prevRenderedKeysRef = useRef<Set<string>>(new Set())

  // Normalize chain to the server's expected id format for subscriptions is now centralized in utils/chain

  // Fetch function as typed alias to keep TS happy with JS module
  const fetchScannerTyped = fetchScanner as unknown as (p: GetScannerResultParams) => Promise<{
    raw: {
      page?: number | null
      scannerPairs?: ScannerResult[] | null
      pairs?: ScannerResult[] | null
      stats?: Record<string, unknown> | null
      totalRows?: number | null
    }
  }>
  const buildPairSubscriptionSafe = buildPairSubscription as unknown as (p: {
    pair: string
    token: string
    chain: string
  }) => { event: 'subscribe-pair'; data: { pair: string; token: string; chain: string } }
  const buildPairStatsSubscriptionSafe = buildPairStatsSubscription as unknown as (p: {
    pair: string
    token: string
    chain: string
  }) => { event: 'subscribe-pair-stats'; data: { pair: string; token: string; chain: string } }
  const computePairPayloadsSafe = computePairPayloads as unknown as (
    items: ScannerResult[] | unknown[],
  ) => { pair: string; token: string; chain: string }[]

  // Deduplicate scannerPairs by pairAddress (case-insensitive) — centralized utility
  // Use shared helper to keep behavior consistent across panes and loads

  // Track currently visible subscription keys (pair|token|chain)
  const visibleKeysRef = useRef<Set<string>>(new Set())
  // Subscription lock refs
  const lockActiveRef = useRef<boolean>(false)
  const lockAllowedRef = useRef<Set<string>>(new Set())

  // Allow App to share a single WebSocket but also support direct sends if present on window.
  useEffect(() => {
    // Discover the shared WS ref stashed by App (escape hatch to avoid extra props)
    const anyWin = window as unknown as { __APP_WS__?: WebSocket }
    wsRef.current = anyWin.__APP_WS__ ?? null
    try {
      const rs = wsRef.current?.readyState
      console.log(
        '[TokensPane:' + title + '] mount; discovered __APP_WS__ readyState=' + String(rs),
      )
    } catch {
      /* no-op */
    }
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
        console.log(
          '[TokensPane:' +
            title +
            '] detected __APP_WS__ later; readyState=' +
            String(ws.readyState),
        )
        // If socket is OPEN, (re)send subscriptions for currently visible keys
        if (ws.readyState === WebSocket.OPEN) {
          try {
            const keys = Array.from(visibleKeysRef.current)
            console.log(
              '[TokensPane:' + title + '] late attach subscribing visible keys:',
              keys.length,
            )
            for (const key of keys) {
              const [pair, token, chain] = key.split('|')
              // only send when this pane is the first visible viewer
              const { prev } = markVisible(key)
              if (prev === 0) {
                sendSubscribe(ws, { pair, token, chain })
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
    return () => {
      clearInterval(interval)
    }
  }, [buildPairSubscriptionSafe, buildPairStatsSubscriptionSafe, title])

  // Run initial data load only once per pane; do not reset rows on filter changes
  const didInitRef = useRef<boolean>(false)

  // Initial REST load (page must start at 1 for every pane)
  useEffect(() => {
    let cancelled = false

    // Run only once per pane mount; do not re-fetch or reset due to filter changes
    if (didInitRef.current) {
      return () => {
        cancelled = true
      }
    }
    didInitRef.current = true

    // Only dispatch empty page and skip fetch if chains are empty at mount
    const chainsProvidedEmpty =
      Array.isArray(clientFilters?.chains) && clientFilters.chains.length === 0
    if (chainsProvidedEmpty) {
      try {
        // --- ACTION TYPE CLARIFICATION ---
        // We dispatch 'scanner/pairs' here when chains are empty or on error, and the payload is an empty array or raw results.
        // This allows the reducer to clear/reset the page or handle unmapped data.
        // Use 'scanner/pairs' for raw or empty payloads, and 'scanner/pairsTokens' for mapped tokens.
        // ----------------------------------
        dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
      } catch (err) {
        logCatch(`[TokensPane:${title}] init: dispatch empty pairs on empty chains failed`, err)
      }
      try {
        console.log(`[Loading:${title}] clearing because chains list is empty at mount`)
      } catch {}
      setLoading(false)
      setHasMore(false)
      return () => {
        /* frozen: nothing to cleanup */
      }
    }
    // Otherwise, always fetch and dispatch real data
    // Failsafe: clear loading if init doesn't complete in time to avoid stuck spinner
    let timeoutId: number | null = null
    const armFailsafe = () => {
      try {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
      } catch {}
      try {
        timeoutId = window.setTimeout(() => {
          if (cancelled) return
          try {
            console.warn(`[Loading:${title}] failsafe timeout fired (10s) — clearing loading`)
          } catch {}
          setLoading(false)
          setError((prev) => prev ?? 'Initial load timed out. Please retry or adjust filters.')
        }, 10000)
      } catch {
        /* no-op */
      }
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      armFailsafe()
      try {
        console.log('[TokensPane:' + title + '] fetching initial scanner page with filters', {
          ...filters,
          page: 1,
        })
        const res = await fetchScannerTyped({ ...filters, page: 1 })
        if (cancelled) return
        const tokens = Array.isArray(res.raw.scannerPairs) ? res.raw.scannerPairs : []
        // Check for address-like ids
        const addressLikeIds = tokens.filter(
          (token) => token && typeof token.id === 'string' && token.id.length === 42,
        )
        if (addressLikeIds.length > 0) {
          console.warn(
            '[TokensPane:' + title + '] token with id of address length:',
            addressLikeIds[0],
          )
        }
        // Deduplicate by pairAddress (case-insensitive) before computing payloads/dispatching
        const dedupedList = dedupeByPairAddress(tokens)
        console.log('[TokensPane:' + title + '] dispatching scanner/pairs:', {
          page,
          scannerPairs: dedupedList,
        })
        dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: dedupedList } })
        try {
          console.log(
            `[Loading:${title}] clearing after initial fetch success; rows will derive shortly`,
          )
        } catch {}
        setLoading(false)
        // Debug: print first few tokens and their id values
        console.log(
          '[TokensPane:' + title + '] mapped tokens sample:',
          dedupedList.slice(0, 5).map((t) => ({
            id: t.id,
            pairAddress: t.pairAddress,
            token1Address: t.token1Address,
            tokenName: t.token1Name,
          })),
        )
        // Best-effort: compute subscription payloads and update universe after dispatch.
        try {
          const payloads = computePairPayloadsSafe(dedupedList)
          payloadsRef.current = payloads
          try {
            const keys = payloads.map((p) => buildPairKey(p.pair, p.token, p.chain))
            SubscriptionQueue.updateUniverse(keys, wsRef.current ?? null)
          } catch (err) {
            if (err instanceof Error) {
              logCatch(`[TokensPane:${title}] updateUniverse (init) failed`, err)
            } else {
              logCatch(`[TokensPane:${title}] updateUniverse (init) failed`, new Error(String(err)))
            }
          }
          // Deduplicate pair ids for this pane to avoid duplicate row keys (computePairPayloads emits chain variants)
          const seenPairs = new Set<string>()
          const localIds: string[] = []
          for (const p of payloads) {
            if (typeof p.pair === 'string' && !seenPairs.has(p.pair)) {
              seenPairs.add(p.pair)
              localIds.push(p.pair)
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            logCatch(`[TokensPane:${title}] computePairPayloadsSafe failed`, err)
          } else {
            logCatch(`[TokensPane:${title}] computePairPayloadsSafe failed`, new Error(String(err)))
          }
        }
        // Do not subscribe all pairs here; subscriptions are gated by row viewport visibility.
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load data'
        console.error('[TokensPane:' + title + '] fetch failed', e)
        // Mark page as initialized with no rows so App overlay can clear
        try {
          // --- ACTION TYPE CLARIFICATION ---
          // We dispatch 'scanner/pairs' here when chains are empty or on error, and the payload is an empty array or raw results.
          // This allows the reducer to clear/reset the page or handle unmapped data.
          // Use 'scanner/pairs' for raw or empty payloads, and 'scanner/pairsTokens' for mapped tokens.
          // ----------------------------------
          dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
        } catch {
          /* no-op */
        }
        if (!cancelled) setError(msg)
      } finally {
        try {
          if (timeoutId != null) {
            window.clearTimeout(timeoutId)
            timeoutId = null
          }
        } catch {}
        if (!cancelled) {
          try {
            console.log(
              `[Loading:${title}] clearing in finally after init fetch (cancelled=${cancelled})`,
            )
          } catch {}
          setLoading(false)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
      try {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
        }
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, title])

  // Derive rows for this pane from global byId
  const rows = useMemo(() => {
    // Derive strictly from the ids assigned to this pane's page to avoid mixing datasets
    const ids = state.pages[page] ?? []
    const listed = Array.isArray(ids) ? ids : []
    const collected: TokenRow[] = []
    for (const id of listed) {
      const lowerId = id.toLowerCase()
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
    const maxAgeMs =
      cf.maxAgeHours == null || Number.isNaN(cf.maxAgeHours)
        ? null
        : Math.max(0, cf.maxAgeHours) * 3600_000
    const now = Date.now()
    let base = collected.filter((t) => {
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
    // Apply token search filter (reuses DetailModal rules). Only applies when a query is present.
    if (cf.tokenQuery && cf.tokenQuery.trim().length > 0) {
      const allowed = filterRowsByTokenQuery({
        rows: base,
        query: cf.tokenQuery.trim(),
        includeStale: !!cf.includeStale,
        includeDegraded: !!cf.includeDegraded,
      })
      base = base.filter((t) => allowed.has(t.id))
    }
    // Fallback: if page has no ids yet (e.g., before first WS/REST), show empty until data arrives
    const sorter = (key: SortKey, dir: Dir) => (a: TokenRow, b: TokenRow) => {
      const getVal = (t: TokenRow): number | string => {
        switch (key) {
          case 'age':
            return t.tokenCreatedTimestamp.getTime()
          case 'tx':
            return t.transactions.buys + t.transactions.sells
          case 'liquidity':
            return t.liquidity.current
          case 'fresh': {
            const any = t as unknown as {
              scannerAt?: unknown
              tickAt?: unknown
              pairStatsAt?: unknown
            }
            const s = typeof any.scannerAt === 'number' ? any.scannerAt : -Infinity
            const ti = typeof any.tickAt === 'number' ? any.tickAt : -Infinity
            const p = typeof any.pairStatsAt === 'number' ? any.pairStatsAt : -Infinity
            return Math.max(s, ti, p)
          }
          case 'tokenName':
            return t.tokenName.toLowerCase()
          case 'exchange':
            return t.exchange.toLowerCase()
          case 'priceUsd':
            return t.priceUsd
          case 'mcap':
            return t.mcap
          case 'volumeUsd':
            return t.volumeUsd
          default:
            return 0
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
    const limit =
      clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
        ? clientFilters.limit
        : Number.POSITIVE_INFINITY
    const cap = Math.min(visibleCount, limit)
    const finalRows = sorted.slice(0, Number.isFinite(cap) ? cap : visibleCount)
    try {
      debugLog(`[TokensPane:${title}] rows derived`, {
        page,
        ids: listed.length,
        collected: collected.length,
        afterFilters: base.length,
        rendering: finalRows.length,
      })
    } catch {}
    return finalRows
  }, [state.byId, state.pages, page, sort, clientFilters, visibleCount, title])

  // Ensure the loading spinner is dismissed as soon as we actually have rows to render,
  // even if some upstream flag forgot to clear. This prevents masking ready data under
  // a stale "Loading…" indicator.
  useEffect(() => {
    try {
      if (loading && rows.length > 0) {
        console.log(
          `[Loading:${title}] auto-clear: rows.length=${rows.length} (>0) while loading=true`,
        )
        setLoading(false)
      }
    } catch {
      /* no-op */
    }
  }, [rows.length, loading, title])

  // Log any loading state transition with current rows count for root-cause tracing
  useEffect(() => {
    try {
      console.log(
        `[Loading:${title}] state now ${loading ? 'true' : 'false'}; rows.length=${rows.length}`,
      )
    } catch {}
  }, [loading, rows.length, title])

  const paneIdRef = useRef<string>('')
  useEffect(() => {
    paneIdRef.current = title
  }, [title])

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
    } catch {
      /* no-op */
    }
  }, [rows, onChainCountsChange, page])

  // When the rendered rows change (due to limit/sort), just update tracking; do not force unsubscribe.
  useEffect(() => {
    try {
      const currentKeys = new Set<string>()
      for (const row of rows) {
        const pair = row.pairAddress
        const token = row.tokenAddress
        if (!pair || !token) continue
        const key = buildPairKey(pair, token.toLowerCase(), row.chain)
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
            // Let SubscriptionQueue enforce quotas for now-hidden rows
            try {
              SubscriptionQueue.setVisible(key, false, ws, 'TokensPane:rowsEffect/remove')
            } catch {}
          } catch (err) {
            console.error(
              `[TokensPane:${title}] tracking update on removal failed for`,
              key,
              String(err),
            )
          }
        }
      }
    } catch {
      /* no-op */
    }
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
          console.log(`[TokensPane:${title}] rows derived`, {
            count: rows.length,
            firstId: first.id,
            firstPrice: first.priceUsd,
            version,
          })
        } else {
          console.log(`[TokensPane:${title}] rows derived`, { count: 0, version })
        }
      }
    } catch {
      /* no-op */
    }
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
    // Respect per-table row limit from clientFilters; 0 or undefined means no limit
    const limit =
      clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
        ? clientFilters.limit
        : null
    if (limit != null && rowsRef.current.length >= limit) {
      // We've already reached the cap; stop infinite scroll
      if (hasMore) setHasMore(false)
      return
    }
    if (bothEndsVisible) return
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = currentPage + 1
      console.log(`[TokensPane:${title}] loading more: page ${String(nextPage)}`)
      const res = await fetchScannerTyped({ ...filters, page: nextPage })
      const raw = res.raw as unknown
      const list =
        raw && typeof raw === 'object' && Array.isArray((raw as { pairs?: unknown[] }).pairs)
          ? (raw as { pairs: unknown[] }).pairs
          : []
      // Deduplicate by pairAddress (case-insensitive)
      const dedupedList = dedupeByPairAddress(list as ScannerResult[])
      // Merge new payloads into our cumulative payloadsRef and update SubscriptionQueue universe
      // Dispatch append EARLY to ensure rows appear even if later steps fail.
      dispatch({
        type: 'scanner/append',
        payload: { page, scannerPairs: dedupedList },
      } as ScannerAppendAction)
      try {
        console.info(`[TokensPane:${title}] dispatched scanner/append`, {
          page,
          added: dedupedList.length,
        })
      } catch {}

      // Best-effort: compute/update subscription universe after dispatch
      try {
        const newPayloads = computePairPayloadsSafe(dedupedList)
        const all = [...(payloadsRef.current || []), ...newPayloads]
        // Deduplicate by full key pair|token|chain
        const seen = new Set<string>()
        const merged: { pair: string; token: string; chain: string }[] = []
        for (const p of all) {
          const key = buildPairKey(p.pair, (p.token ?? '').toLowerCase(), p.chain)
          if (seen.has(key)) continue
          seen.add(key)
          merged.push(p)
        }
        payloadsRef.current = merged
        const keys = merged.map((p) => buildPairKey(p.pair, (p.token ?? '').toLowerCase(), p.chain))
        SubscriptionQueue.updateUniverse(keys, wsRef.current ?? null)
      } catch (err) {
        logCatch(`[TokensPane:${title}] updateUniverse (loadMore) failed`, err)
      }
      // Increase visible count so user sees more rows immediately, but do not exceed limit
      setVisibleCount((c) => {
        const limit =
          clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
            ? clientFilters.limit
            : Number.POSITIVE_INFINITY
        const next = c + 50
        return Math.min(next, limit)
      })
      setCurrentPage(nextPage)
      // If server returned no items, or we've hit the configured limit, stop auto-loading
      const limitVal =
        clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
          ? clientFilters.limit
          : null
      if (dedupedList.length === 0 || (limitVal != null && rowsRef.current.length >= limitVal)) {
        setHasMore(false)
      }
    } catch (err) {
      console.error(`[TokensPane:${title}] loadMore failed`, err)
      // On error, stop auto-loading to prevent tight loops
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [
    loadingMore,
    hasMore,
    currentPage,
    fetchScannerTyped,
    filters,
    dispatch,
    page,
    bothEndsVisible,
    computePairPayloadsSafe,
    title,
    clientFilters,
  ])

  // Load more when the scroll-trigger row (10 above the last) enters the viewport of the pane
  // We rely on Table to tag rows with data-last-row and data-scroll-trigger.
  // Rebind the observer whenever the identity of the last/trigger row changes, not only when length changes.
  // Debounced so bulk updates (e.g., append many rows) only cause a single rebind.
  const triggerObserverRef = useRef<IntersectionObserver | null>(null)
  const observedTriggerRef = useRef<Element | null>(null)
  const rebindTimeoutRef = useRef<number | null>(null)
  // Compute stable markers from rows order
  const lastRowId = rows.length > 0 ? rows[rows.length - 1]?.id : null
  const triggerRowId = rows.length > 0 ? rows[Math.max(0, rows.length - 10)]?.id : null
  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return
    if (rowsRef.current.length === 0) return
    if (bothEndsVisible) return
    // Stop binding trigger if a hard limit is configured and we've reached it
    const hardLimit =
      clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
        ? clientFilters.limit
        : null
    if (hardLimit != null && rows.length >= hardLimit) {
      return
    }
    // debounce rebind by 100ms
    if (rebindTimeoutRef.current != null) {
      try {
        window.clearTimeout(rebindTimeoutRef.current)
      } catch {
        /* no-op */
      }
      rebindTimeoutRef.current = null
    }
    rebindTimeoutRef.current = window.setTimeout(() => {
      // find current trigger element in DOM (tagged by Table)
      const triggerEl = root.querySelector('[data-scroll-trigger="1"]')
      const prevEl = observedTriggerRef.current
      // If same element, nothing to do
      if (triggerEl === prevEl && triggerObserverRef.current) return
      // Clean up previous observer if any
      if (triggerObserverRef.current) {
        try {
          if (prevEl) triggerObserverRef.current.unobserve(prevEl)
        } catch {
          /* no-op */
        }
        try {
          triggerObserverRef.current.disconnect()
        } catch {
          /* no-op */
        }
        triggerObserverRef.current = null
      }
      observedTriggerRef.current = triggerEl
      if (!triggerEl) return
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting || entry.intersectionRatio > 0) {
              void loadMore()
            }
          }
        },
        { root, rootMargin: '100px 0px', threshold: 0 },
      )
      triggerObserverRef.current = observer
      try {
        observer.observe(triggerEl)
      } catch {
        /* no-op */
      }
    }, 100)
    return () => {
      if (rebindTimeoutRef.current != null) {
        try {
          window.clearTimeout(rebindTimeoutRef.current)
        } catch {
          /* no-op */
        }
        rebindTimeoutRef.current = null
      }
    }
  }, [lastRowId, triggerRowId, loadMore, bothEndsVisible, clientFilters, rows.length])

  // Handler wired to Table row visibility
  const onRowVisibilityChange = useCallback((row: TokenRow, visible: boolean) => {
    if (scrollingRef.current) return
    const pair = row.pairAddress
    const token = row.tokenAddress
    if (!pair || !token) return
    const key = buildPairKey(pair, token.toLowerCase(), row.chain)
    const disabledKey = disabledKeyFor(row)
    // If this token is disabled, ensure it's not tracked as visible and unsubscribe if needed
    if (disabledKey && disabledTokensRef.current.has(disabledKey)) {
      if (visibleKeysRef.current.has(key)) {
        visibleKeysRef.current.delete(key)
        try {
          const { next } = markHidden(key)
          const ws = wsRef.current
          if (next === 0 && ws && ws.readyState === WebSocket.OPEN) {
            try {
              const stack = new Error('unsubscribe trace').stack
              console.log('[TokensPane] UNSUB', {
                key,
                reason: 'disabled-token visibility change',
                pane: title,
                when: new Date().toISOString(),
                stack,
              })
            } catch {}
            sendUnsubscribe(ws, { pair, token, chain: row.chain })
          }
        } catch {}
      }
      return
    }
    // If subscription lock is active and this key isn't allowed, stop tracking
    if (lockActiveRef.current && !lockAllowedRef.current.has(key)) {
      if (visibleKeysRef.current.delete(key)) {
        try {
          markHidden(key)
        } catch {}
      }
      return
    }
    const set = visibleKeysRef.current
    const ws = wsRef.current
    if (visible) {
      if (!set.has(key)) {
        const { prev } = markVisible(key)
        set.add(key)
        try {
          SubscriptionQueue.setVisible(key, true, ws, 'TokensPane:onRowVisibilityChange/show')
        } catch {}
        if (prev === 0 && ws && ws.readyState === WebSocket.OPEN) {
          try {
            sendSubscribe(ws, { pair, token, chain: row.chain })
          } catch {}
        }
      }
    } else {
      if (set.has(key)) {
        set.delete(key)
        markHidden(key)
        try {
          SubscriptionQueue.setVisible(key, false, ws, 'TokensPane:onRowVisibilityChange/hide')
        } catch {}
        // Do not auto-unsubscribe on leaving viewport; let SubscriptionQueue manage inactive rows
      }
    }
  }, [])

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
            // Only unsubscribe if no other pane still requires the subscription
            if (next === 0) {
              try {
                SubscriptionQueue.noteUnsubscribed(key)
              } catch {}
              try {
                const stack = new Error('unsubscribe trace').stack
                console.log('[TokensPane] UNSUB', {
                  key,
                  reason: 'unmount: no more visible panes for key',
                  pane: title,
                  when: new Date().toISOString(),
                  stack,
                })
              } catch {}
              sendUnsubscribe(ws, { pair, token, chain })
            }
          }
        }
        setAtMount.clear()
      } catch {
        /* ignore unmount unsubscribe errors */
      }
    }
  }, [])

  // Keep rowsRef in sync with derived rows for visibility handlers
  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  // Keep subscription queue universe in sync with the full set of known keys.
  // Merge payload-derived keys with keys derivable from currently rendered rows so we also
  // refresh the universe when the table composition changes due to scrolling/sorting.
  useEffect(() => {
    try {
      const payloads = payloadsRef.current || []
      const keysSet = new Set<string>()
      for (const p of payloads) {
        const pair = p.pair ?? ''
        const tokenAddr = (p.token ?? '').toLowerCase()
        const chain = p.chain ?? ''
        if (!pair || !tokenAddr || !chain) continue
        keysSet.add(buildPairKey(pair, tokenAddr, chain))
      }
      const sourceRows = rowsRef.current && rowsRef.current.length > 0 ? rowsRef.current : rows
      for (const r of sourceRows) {
        const pair = r.pairAddress ?? ''
        const tokenAddr = (r.tokenAddress ?? '').toLowerCase()
        const chain = r.chain
        if (!pair || !tokenAddr || !chain) continue
        keysSet.add(buildPairKey(pair, tokenAddr, chain))
      }
      const keys = Array.from(keysSet)
      SubscriptionQueue.updateUniverse(keys, wsRef.current ?? null)
    } catch {}
  }, [rows])

  // Periodic tick for invisible rolling subscriptions
  useEffect(() => {
    let timer: number | null = null
    const run = () => {
      try {
        SubscriptionQueue.tick(wsRef.current ?? null)
      } catch {}
      timer = window.setTimeout(run, 10000)
    }
    run()
    return () => {
      if (timer != null) {
        try {
          window.clearTimeout(timer)
        } catch {}
      }
    }
  }, [])

  // React to global subscription lock changes (modal focus)
  useEffect(() => {
    try {
      lockActiveRef.current = isSubscriptionLockActive()
      lockAllowedRef.current = new Set(getSubscriptionLockAllowedKeys())
    } catch {
      /* no-op */
    }
    const off = onSubscriptionLockChange((st: { active: boolean; allowed: Set<string> }) => {
      try {
        lockActiveRef.current = st.active
        lockAllowedRef.current = new Set(Array.from(st.allowed))
      } catch {
        /* no-op */
      }
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [])

  // Stable props to prevent unnecessary re-renders in Table
  const handleBothEndsVisible = useCallback((v: boolean) => {
    setBothEndsVisible(v)
  }, [])
  const handleContainerRef = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el
  }, [])
  const handleScrollStart = useCallback(() => {
    // Enter scrolling; do not alter subscriptions anymore. We only mark scrolling state
    // and let IntersectionObserver/onScrollStop handle precise visibility transitions.
    scrollingRef.current = true
  }, [])
  const handleToggleRowSubscription = useCallback(
    (row: TokenRow) => {
      const dKey = disabledKeyFor(row)
      if (!dKey) return
      const set = disabledTokensRef.current
      const wasDisabled = set.has(dKey)
      if (wasDisabled) {
        // Re-enable
        set.delete(dKey)
        persistDisabled()
        try {
          const ws = wsRef.current
          const pair = row.pairAddress ?? ''
          const tokenAddr = (row.tokenAddress ?? '').toLowerCase()
          const id = row.chain
          if (pair && tokenAddr) {
            const keyNum = buildPairKey(pair, tokenAddr, id)
            try {
              SubscriptionQueue.setIgnored(keyNum, false, ws)
            } catch {}
          }
        } catch {}
        return
      }
      // Disable: add to set and unsubscribe any active subscriptions for this token
      set.add(dKey)
      persistDisabled()
      try {
        const ws = wsRef.current
        const toRemove: string[] = []
        for (const key of visibleKeysRef.current) {
          const parts = key.split('|')
          const token = parts[1]
          const chain = parts[2]
          if (`${token.toLowerCase()}|${chain}` === dKey) {
            toRemove.push(key)
          }
        }
        for (const key of toRemove) {
          visibleKeysRef.current.delete(key)
          const [pair, token, chain] = key.split('|')
          const { next } = markHidden(key)
          try {
            SubscriptionQueue.setVisible(key, false, ws, 'TokensPane:toggleDisable/hide')
          } catch {}
          if (next === 0 && ws && ws.readyState === WebSocket.OPEN) {
            try {
              SubscriptionQueue.noteUnsubscribed(key)
            } catch {}
            try {
              const stack = new Error('unsubscribe trace').stack
              console.log('[TokensPane] UNSUB', {
                key,
                reason: 'toggleDisable: no more visible panes for key',
                pane: title,
                when: new Date().toISOString(),
                stack,
              })
            } catch {}
            try {
              sendUnsubscribe(ws, { pair, token, chain })
            } catch {}
          }
        }
        // Mark this row's keys as ignored (both chain numeric and name variants)
        try {
          const pair = row.pairAddress ?? ''
          const tokenAddr = (row.tokenAddress ?? '').toLowerCase()
          const id = row.chain
          if (pair && tokenAddr) {
            const keyNum = buildPairKey(pair, tokenAddr, id)
            try {
              SubscriptionQueue.setIgnored(keyNum, true, ws)
            } catch {}
          }
        } catch {}
      } catch {
        /* no-op */
      }
    },
    [persistDisabled],
  )

  // Derive hard limit and reached state for UI/toast
  const limitValue =
    clientFilters && typeof clientFilters.limit === 'number' && clientFilters.limit > 0
      ? clientFilters.limit
      : null
  const limitReached = limitValue != null && rows.length >= limitValue

  const handleShowMeHow = useCallback(() => {
    try {
      const el = document.getElementById('filter-limit-rows')
      if (el) {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch {
          /* no-op */
        }
        // Starburst/glow animation using Web Animations API
        try {
          const originalOutline = el.style.outline
          const originalOutlineOffset = el.style.outlineOffset
          el.style.outline = '2px solid rgba(255,215,0,0.9)'
          el.style.outlineOffset = '2px'
          const kf = [
            { boxShadow: '0 0 0 0 rgba(255,215,0,0.9)' },
            { boxShadow: '0 0 0 14px rgba(255,215,0,0)' },
          ]
          const anim = el.animate(kf, { duration: 900, iterations: 3, easing: 'ease-out' })
          anim.onfinish = () => {
            try {
              el.style.outline = originalOutline
              el.style.outlineOffset = originalOutlineOffset
            } catch {
              /* no-op */
            }
          }
        } catch {
          /* no-op */
        }
      }
    } catch {
      /* no-op */
    }
  }, [])

  console.log('TokensPane mounted:', title)

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
        onBothEndsVisible={handleBothEndsVisible}
        onContainerRef={handleContainerRef}
        onOpenRowDetails={onOpenRowDetails}
        onScrollStart={handleScrollStart}
        onToggleRowSubscription={handleToggleRowSubscription}
        getRowStatus={(row: TokenRow) => {
          const pair = row.pairAddress ?? ''
          const token = row.tokenAddress ?? ''
          if (!pair || !token) return undefined
          const key = buildPairKey(pair, token.toLowerCase(), row.chain)
          const dKey = disabledKeyFor(row)
          if (dKey && disabledTokensRef.current.has(dKey)) {
            const ts = lastUpdatedRef.current.get(key)
            const tooltip = ts ? 'Disabled; last update ' + formatAge(ts) : 'Disabled by you'
            return { state: 'disabled', tooltip }
          }
          if (lockActiveRef.current && !lockAllowedRef.current.has(key)) {
            return { state: 'unsubscribed', tooltip: 'Temporarily unsubscribed (modal focus)' }
          }
          const ts = lastUpdatedRef.current.get(key)
          const tooltip = ts ? 'Data Age: ' + formatAge(ts) : 'No updates yet'
          if (scrollingRef.current) return { state: 'unsubscribed', tooltip }
          if (visibleKeysRef.current.has(key)) return { state: 'subscribed', tooltip }
          return { state: 'unsubscribed', tooltip }
        }}
        onScrollStop={(visibleRows: TokenRow[]) => {
          const ws = wsRef.current
          scrollingRef.current = false
          // Compute keys that should be visible (subscribed)
          const nextVisible: string[] = []
          let skippedDisabled = 0
          let skippedLocked = 0
          for (const row of visibleRows) {
            const pair = row.pairAddress ?? ''
            const token = row.tokenAddress ?? ''
            if (!pair || !token) continue
            const key = buildPairKey(pair, token.toLowerCase(), row.chain)
            // Respect modal lock: only subscribe allowed keys when lock is active
            if (lockActiveRef.current && !lockAllowedRef.current.has(key)) {
              skippedLocked++
              continue
            }
            // Skip disabled tokens
            const dKey = buildTickKey(token.toLowerCase(), row.chain)
            if (disabledTokensRef.current.has(dKey)) {
              skippedDisabled++
              continue
            }
            nextVisible.push(key)
          }
          const nextSet = new Set(nextVisible)
          const prevSet = new Set<string>(visibleKeysRef.current)
          try {
            const added = Array.from(nextSet).filter((k) => !prevSet.has(k))
            const removed = Array.from(prevSet).filter((k) => !nextSet.has(k))
            console.log(`[TokensPane:${title}] onScrollStop diff`, {
              next: nextVisible.length,
              prev: prevSet.size,
              addedCount: added.length,
              removedCount: removed.length,
              addedSample: added.slice(0, 5),
              removedSample: removed.slice(0, 5),
              skippedDisabled,
              skippedLocked,
              time: new Date().toISOString(),
            })
          } catch {}

          if (ws && ws.readyState === WebSocket.OPEN) {
            // Update visibility for keys no longer visible in this pane (no direct unsubscribe)
            for (const key of prevSet) {
              if (nextSet.has(key)) continue
              try {
                markHidden(key)
                try {
                  SubscriptionQueue.setVisible(key, false, ws, 'TokensPane:onScrollStop/hide')
                } catch {}
              } catch (err) {
                console.error(
                  `[TokensPane:${title}] visibility update on scrollStop failed for`,
                  key,
                  String(err),
                )
              }
            }
            // Subscribe newly visible keys
            for (const key of nextSet) {
              if (prevSet.has(key)) continue
              const [pair, token, chain] = key.split('|')
              try {
                const { prev } = markVisible(key)
                try {
                  SubscriptionQueue.setVisible(key, true, ws, 'TokensPane:onScrollStop/show')
                } catch {}
                if (prev === 0) {
                  sendSubscribe(ws, { pair, token, chain })
                }
              } catch (err) {
                console.error(
                  `[TokensPane:${title}] subscribe on scrollStop failed for`,
                  key,
                  String(err),
                )
              }
            }
          }
          visibleKeysRef.current = nextSet
        }}
      />
      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && <div className="status">Loading more…</div>}
      {!hasMore && (
        <div className="status muted" style={{ fontSize: 12 }}>
          No more results
        </div>
      )}
      {limitReached && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 8,
            border: '1px solid #374151',
            background: 'rgba(17,24,39,0.85)',
            color: '#e5e7eb',
            borderRadius: 8,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span className="muted" style={{ fontSize: 12 }}>
            limit reached, increase to load more
          </span>
          <button
            type="button"
            onClick={handleShowMeHow}
            style={{
              background: '#111827',
              color: '#e5e7eb',
              border: '1px solid #4b5563',
              borderRadius: 12,
              padding: '4px 10px',
              fontSize: 12,
              letterSpacing: 0.3,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Scroll to filters and highlight the Limit control"
          >
            show me how
          </button>
        </div>
      )}
    </div>
  )
}
