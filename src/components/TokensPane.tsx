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
import { markVisible, markHidden, getCount } from '../visibility.bus.js'
import { SubscriptionQueue } from '../subscription.queue'
import { formatAge } from '../helpers/format'
import type { GetScannerResultParams, ScannerResult } from '../test-task-types'
import { toChainId } from '../utils/chain'
import { buildPairKey } from '../utils/key_builder'
import { dedupeByPairAddress } from '../utils/dedupeByPairAddress'
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
        const arr = JSON.parse(raw)
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
    const chain = toChainId(row.chain)
    return `${token.toLowerCase()}|${chain}`
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

  // Initial REST load (page must start at 1 for every pane)
  useEffect(() => {
    let cancelled = false
    // reset infinite scroll state on new mount/filters
    setVisibleCount(50)
    setCurrentPage(1)
    setHasMore(true)
    // If the client filters specify no chains selected, freeze the pane: clear rows and skip fetching.
    const chainsProvidedEmpty =
      Array.isArray(clientFilters?.chains) && clientFilters.chains.length === 0
    if (chainsProvidedEmpty) {
      try {
        dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
      } catch {
        /* no-op */
      }
      setLoading(false)
      setHasMore(false)
      return () => {
        /* frozen: nothing to cleanup */
      }
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        console.log('[TokensPane:' + title + '] fetching initial scanner page with filters', {
          ...filters,
          page: 1,
        })
        const res = await fetchScannerTyped({ ...filters, page: 1 })
        if (cancelled) return
        const raw = res.raw as unknown
        // Production shape: { pairs: [...] }
        const pairsArr =
          raw && typeof raw === 'object' && Array.isArray((raw as { pairs?: unknown[] }).pairs)
            ? (raw as { pairs: unknown[] }).pairs
            : null
        if (!pairsArr) {
          const errMsg = 'Unexpected data shape from /scanner: missing or invalid pairs array'
          // Surface loudly in console and UI
          console.error(errMsg, raw)
          // Mark page as initialized with no rows so App overlay can clear
          try {
            dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
          } catch {
            /* no-op */
          }
          if (!cancelled) setError(errMsg)
          return
        }
        const list = pairsArr
        console.log(
          '[TokensPane:' + title + '] /scanner returned ' + String(list.length) + ' items',
        )
        // Deduplicate by pairAddress (case-insensitive) before computing payloads/dispatching
        const dedupedList = dedupeByPairAddress(list as ScannerResult[])
        if (dedupedList.length !== list.length) {
          console.log(
            '[TokensPane:' +
              title +
              '] deduped initial list: ' +
              String(list.length - dedupedList.length) +
              ' duplicates removed',
          )
        }
        // Update local ids for this pane only
        const payloads = computePairPayloadsSafe(dedupedList)
        payloadsRef.current = payloads
                try {
                  const keys = payloads.map((p) => buildPairKey(p.pair, p.token, p.chain))
                  SubscriptionQueue.updateUniverse(keys, wsRef.current ?? null)
                } catch {}
        // Deduplicate pair ids for this pane to avoid duplicate row keys (computePairPayloads emits chain variants)
        const seenPairs = new Set<string>()
        const localIds: string[] = []
        for (const p of payloads) {
          if (!seenPairs.has(p.pair)) {
            seenPairs.add(p.pair)
            localIds.push(p.pair)
          }
        }
        console.log(
          '[TokensPane:' +
            title +
            `] computed ${String(payloads.length)} pair subscription payloads and ${String(localIds.length)} unique pair ids for table`,
        )
        // Merge into global store (byId/meta) — page value is irrelevant for panes
        dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: list } })
        // Do not subscribe all pairs here; subscriptions are gated by row viewport visibility.
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load data'
        console.error('[TokensPane:' + title + '] fetch failed', e)
        // Mark page as initialized with no rows so App overlay can clear
        try {
          dispatch({ type: 'scanner/pairs', payload: { page, scannerPairs: [] } })
        } catch {
          /* no-op */
        }
        if (!cancelled) setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    filters,
    clientFilters,
    dispatch,
    fetchScannerTyped,
    computePairPayloadsSafe,
    buildPairSubscriptionSafe,
    buildPairStatsSubscriptionSafe,
    page,
    title,
  ])

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
    const base = collected.filter((t) => {
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
    const sorter = (key: SortKey, dir: Dir) => (a: TokenRow, b: TokenRow) => {
      const getVal = (t: TokenRow): number | string => {
        switch (key) {
          case 'age':
            return t.tokenCreatedTimestamp.getTime()
          case 'tx':
            return t.transactions.buys + t.transactions.sells
          case 'liquidity':
            return t.liquidity.current
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
    return sorted.slice(0, Number.isFinite(cap) ? cap : visibleCount)
  }, [state.byId, state.pages, page, sort, clientFilters, visibleCount])

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
        const key = buildPairKey(pair, token, row.chain)
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
            try { SubscriptionQueue.setVisible(key, false, ws) } catch {}
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
      } catch {}
      // Dispatch typed append
      dispatch({
        type: 'scanner/append',
        payload: { page, scannerPairs: dedupedList },
      } as ScannerAppendAction)
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
  }, [
    loadingMore,
    hasMore,
    currentPage,
    fetchScannerTyped,
    filters,
    dispatch,
    page,
    title,
    bothEndsVisible,
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
  }, [lastRowId, triggerRowId, loadMore, bothEndsVisible])

  // Handler wired to Table row visibility
  const onRowVisibilityChange = useCallback(
    (row: TokenRow, visible: boolean) => {
      if (scrollingRef.current) return
      const pair = row.pairAddress
      const token = row.tokenAddress
      if (!pair || !token) return
      const chain = toChainId(row.chain)
      const key = buildPairKey(pair, token, chain)
      const disabledKey = disabledKeyFor(row)
      // If this token is disabled, ensure it's not tracked as visible and unsubscribe if needed
      if (disabledKey && disabledTokensRef.current.has(disabledKey)) {
        if (visibleKeysRef.current.has(key)) {
          visibleKeysRef.current.delete(key)
          try {
            const { next } = markHidden(key)
            const ws = wsRef.current
            if (next === 0 && ws && ws.readyState === WebSocket.OPEN) {
              sendUnsubscribe(ws, { pair, token, chain })
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
          try { SubscriptionQueue.setVisible(key, true, ws) } catch {}
          if (prev === 0 && ws && ws.readyState === WebSocket.OPEN) {
            try {
              sendSubscribe(ws, { pair, token, chain })
            } catch {}
          }
        }
      } else {
        if (set.has(key)) {
          set.delete(key)
          const { next } = markHidden(key)
          try { SubscriptionQueue.setVisible(key, false, ws) } catch {}
          // Do not auto-unsubscribe on leaving viewport; let SubscriptionQueue manage inactive rows
        }
      }
    },
    [title],
  )

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

  // Keep subscription queue universe in sync with the full set of loaded payloads (not just visible rows)
  useEffect(() => {
    try {
      const payloads = payloadsRef.current || []
      const keys: string[] = []
      for (const p of payloads) {
        const pair = p.pair ?? ''
        const tokenAddr = (p.token ?? '').toLowerCase()
        const chain = p.chain ?? ''
        if (!pair || !tokenAddr || !chain) continue
        keys.push(buildPairKey(pair, tokenAddr, chain))
      }
      SubscriptionQueue.updateUniverse(keys, wsRef.current ?? null)
    } catch {}
  }, [rows])

  // Periodic tick for inactive rolling subscriptions
  useEffect(() => {
    let timer: number | null = null
    const run = () => {
      try {
        SubscriptionQueue.tick(wsRef.current ?? null)
      } catch {}
      timer = window.setTimeout(run, 2000)
    }
    run()
    return () => {
      if (timer != null) {
        try { window.clearTimeout(timer) } catch {}
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
        onBothEndsVisible={(v) => {
          setBothEndsVisible(v)
        }}
        onContainerRef={(el) => {
          scrollContainerRef.current = el
        }}
        onOpenRowDetails={onOpenRowDetails}
        onScrollStart={() => {
          // Enter scrolling; temporarily consider rows unsubscribed until scroll stops
          scrollingRef.current = true
          const ws = wsRef.current
          const visibleNow = new Set<string>(visibleKeysRef.current)
          if (ws && ws.readyState === WebSocket.OPEN) {
            for (const key of visibleNow) {
              try {
                const { next } = markHidden(key)
                try { SubscriptionQueue.setVisible(key, false, ws) } catch {}
                // Do not auto-unsubscribe during scroll; SubscriptionQueue manages inactive rotation
              } catch (err) {
                console.error(`[TokensPane:${title}] bulk-visibility update failed for`, key, String(err))
              }
            }
          }
          visibleKeysRef.current.clear()
        }}
        onToggleRowSubscription={(row: TokenRow) => {
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
              const id = toChainId(row.chain)
              if (pair && tokenAddr) {
                const keyNum = buildPairKey(pair, tokenAddr, id)
                try { SubscriptionQueue.setIgnored(keyNum, false, ws) } catch {}
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
              try { SubscriptionQueue.setVisible(key, false, ws) } catch {}
              if (next === 0 && ws && ws.readyState === WebSocket.OPEN) {
                try {
                  sendUnsubscribe(ws, { pair, token, chain })
                } catch {}
              }
            }
            // Mark this row's keys as ignored (both chain numeric and name variants)
            try {
              const pair = row.pairAddress ?? ''
              const tokenAddr = (row.tokenAddress ?? '').toLowerCase()
              const id = toChainId(row.chain)
              if (pair && tokenAddr) {
                const keyNum = buildPairKey(pair, tokenAddr, id)
                try { SubscriptionQueue.setIgnored(keyNum, true, ws) } catch {}
              }
            } catch {}
          } catch {
            /* no-op */
          }
        }}
        getRowStatus={(row: TokenRow) => {
          const pair = row.pairAddress ?? ''
          const token = row.tokenAddress ?? ''
          if (!pair || !token) return undefined
          const key = buildPairKey(pair, token, row.chain)
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
          for (const row of visibleRows) {
            const pair = row.pairAddress ?? ''
            const token = row.tokenAddress ?? ''
            if (!pair || !token) continue
            const chain = toChainId(row.chain)
            const key = buildPairKey(pair, token, chain)
            // Respect modal lock: only subscribe allowed keys when lock is active
            if (lockActiveRef.current && !lockAllowedRef.current.has(key)) continue
            // Skip disabled tokens
            const dKey = `${token.toLowerCase()}|${chain}`
            if (disabledTokensRef.current.has(dKey)) continue
            nextVisible.push(key)
          }
          const nextSet = new Set(nextVisible)
          const prevSet = new Set<string>(visibleKeysRef.current)

          if (ws && ws.readyState === WebSocket.OPEN) {
            // Update visibility for keys no longer visible in this pane (no direct unsubscribe)
            for (const key of prevSet) {
              if (nextSet.has(key)) continue
              try {
                const { next } = markHidden(key)
                try { SubscriptionQueue.setVisible(key, false, ws) } catch {}
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
                try { SubscriptionQueue.setVisible(key, true, ws) } catch {}
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
    </div>
  )
}
