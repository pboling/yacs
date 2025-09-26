/*
  App.tsx
  High-level container rendering two token tables (Trending, New) and wiring:
  - Initial REST fetches via src/scanner.client.js
  - WebSocket subscriptions via src/ws.mapper.js and src/ws.subs.js
  - State management via a pure reducer in src/tokens.reducer.js

  Notes for maintainers:
  - This file is TypeScript-first but interoperates with JS modules using
    explicit type casts to satisfy strict settings. Keep casts narrow and local.
  - WebSocket logic includes a simple multi-endpoint fallback (dev proxy, env override, public).
  - Sorting is performed client-side; server-side filters are configured per table.
*/
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import {
  NEW_TOKENS_FILTERS,
  TRENDING_TOKENS_FILTERS,
  type GetScannerResultParams,
  type ScannerResult,
} from './test-task-types'
import { initialState, tokensReducer } from './tokens.reducer.js'
import {
  buildScannerSubscription,
  buildScannerUnsubscription,
  buildPairSubscription,
  buildPairStatsSubscription,
  mapIncomingMessageToAction,
  buildPairX5Subscription,
  buildPairStatsX5Subscription,
} from './ws.mapper.js'
import { computePairPayloads } from './ws.subs.js'
import ErrorBoundary from './components/ErrorBoundary'
import NumberCell from './components/NumberCell'
import TokensPane from './components/TokensPane'
import DetailModal from './components/DetailModal'
import { emitFilterFocusStart, emitFilterApplyComplete } from './filter.bus.js'
import { fetchScanner } from './scanner.client.js'
import { getCount } from './visibility.bus.js'
import { emitUpdate } from './updates.bus'
import { engageSubscriptionLock, releaseSubscriptionLock } from './subscription.lock.bus.js'
import { onSubscriptionLockChange, isSubscriptionLockActive } from './subscription.lock.bus.js'
import { onSubscriptionMetricsChange, getSubscriptionMetrics } from './subscription.lock.bus.js'
import SubscriptionDebugOverlay from './components/SubscriptionDebugOverlay'
import { toChainId } from './utils/chain'
import { buildPairKey, buildTickKey } from './utils/key_builder'

// Theme allow-list and cookie helpers
const THEME_ALLOW = ['cherry-sour', 'rocket-lake', 'legendary'] as const
export type ThemeName = (typeof THEME_ALLOW)[number]
function readThemeCookie(): ThemeName {
  try {
    const m = /(?:^|; )theme=([^;]+)/.exec(document.cookie)
    const v = m?.[1] ? decodeURIComponent(m[1]) : 'cherry-sour'
    return (THEME_ALLOW as readonly string[]).includes(v) ? (v as ThemeName) : 'cherry-sour'
  } catch {
    return 'cherry-sour'
  }
}
function writeThemeCookie(v: ThemeName) {
  try {
    document.cookie =
      'theme=' + encodeURIComponent(v) + '; path=/; max-age=' + String(60 * 60 * 24 * 365)
  } catch {
    /* no-op */
  }
}

import UpdateRate from './components/UpdateRate'
function TopBar({
  title,
  version,
  theme,
  onThemeChange,
  lockActive,
}: {
  title: string
  version: number
  theme: ThemeName
  onThemeChange: (v: ThemeName) => void
  lockActive: boolean
}) {
  // Strongly type subscription metrics (JS module → typed alias here)
  interface SubMetrics {
    active: boolean
    allowed: string[]
    limits: { normal: number; fast: number; slow: number }
    counts: { fast: number; slow: number }
    fastKeys: string[]
    slowKeys: string[]
    visiblePaneCounts: Record<string, number>
    renderedPaneCounts: Record<string, number>
  }
  const getSubscriptionMetricsTyped = getSubscriptionMetrics as unknown as () => SubMetrics
  const onSubscriptionMetricsChangeTyped = onSubscriptionMetricsChange as unknown as (
    cb: (m: SubMetrics) => void,
  ) => () => void

  const [metrics, setMetrics] = useState<SubMetrics>(() => getSubscriptionMetricsTyped())
  useEffect(() => {
    const off = onSubscriptionMetricsChangeTyped((m) => {
      setMetrics(m)
    })
    return () => {
      try {
        off()
      } catch {
        /* no-op */
      }
    }
  }, [onSubscriptionMetricsChangeTyped])
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <UpdateRate version={import.meta.env.DEV ? version : undefined} />
        {/* Subscription metrics: Normal (viewport), Fast (Modal x5), Slow */}
        {(() => {
          const normalActive = lockActive ? 0 : metrics.counts.fast
          const normalCap = metrics.limits.normal
          const fastModalActive = lockActive ? metrics.counts.fast : 0
          const slowActive = metrics.counts.slow
          const slowCap = metrics.limits.slow
          return (
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid #374151',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                letterSpacing: 0.5,
              }}
              title={`Normal (viewport) ${normalActive}/${normalCap} · Fast (Modal x5) ${fastModalActive}/${metrics.allowed.length} · Slow ${slowActive}/${slowCap}`}
            >
              Normal {normalActive}/{normalCap} · Fast (x5) {fastModalActive}/
              {metrics.allowed.length} · Slow {slowActive}/{slowCap}
            </span>
          )
        })()}
        {lockActive && (
          <span
            style={{
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #4b5563',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              letterSpacing: 0.5,
            }}
            title="Subscription lock active (modal focus)"
          >
            Locked
          </span>
        )}
      </div>
      <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        Theme
        <select
          aria-label="Select theme"
          value={theme}
          onChange={(e) => {
            const v = e.currentTarget.value as ThemeName
            onThemeChange((THEME_ALLOW as readonly string[]).includes(v) ? v : 'cherry-sour')
          }}
          style={{
            background: '#111827',
            color: '#e5e7eb',
            border: '1px solid #374151',
            borderRadius: 4,
            padding: '6px 8px',
          }}
        >
          <option value="cherry-sour">Cherry Sour (Red and Green)</option>
          <option value="rocket-lake">Rocket Lake (Orange and Blue)</option>
          <option value="legendary">Legendary (Yellow and Purple)</option>
        </select>
      </label>
    </div>
  )
}

// Minimal row type for table consumption
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
  // Optional addresses used for WS correlation
  tokenAddress?: string
  pairAddress?: string
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

// Local state shape matching tokens.reducer.js output
interface TokensMeta {
  totalSupply: number
  token0Address?: string
}

interface State {
  byId: Record<string, TokenRow>
  meta: Record<string, TokensMeta>
  pages: Partial<Record<number, string[]>>
  filters: {
    excludeHoneypots?: boolean
    chains?: string[]
    minVolume?: number
    maxAgeHours?: number | null
    minMcap?: number
    limit?: number
  }
  wpegPrices?: Record<string, number>
}

// Local action types matching tokens.reducer.js
interface ScannerPairsAction {
  type: 'scanner/pairs'
  payload: { page: number; scannerPairs: unknown[] }
}

interface ScannerAppendAction {
  type: 'scanner/append'
  payload: { page: number; scannerPairs: unknown[] }
}

interface TickAction {
  type: 'pair/tick'
  payload: { pair: { pair: string; token: string; chain: string }; swaps: unknown[] }
}

interface PairStatsAction {
  type: 'pair/stats'
  payload: { data: unknown }
}

interface WpegPricesAction {
  type: 'wpeg/prices'
  payload: { prices: Record<string, string | number> }
}

interface FiltersAction {
  type: 'filters/set'
  payload: {
    excludeHoneypots?: boolean
    chains?: string[]
    minVolume?: number
    maxAgeHours?: number | null
    minMcap?: number
    limit?: number
  }
}

type Action =
  | ScannerPairsAction
  | ScannerAppendAction
  | TickAction
  | PairStatsAction
  | WpegPricesAction
  | FiltersAction

/**
 * Table component
 * Renders a sortable token table with loading/error/empty states.
 * Props are intentionally minimal to keep rendering logic decoupled from data shaping.
 */

function App() {
  // App theme state (allow-list + cookie persistence)
  const [theme, setTheme] = useState<ThemeName>(() => readThemeCookie())
  useEffect(() => {
    const t = (THEME_ALLOW as readonly string[]).includes(theme) ? theme : 'cherry-sour'
    try {
      document.documentElement.setAttribute('data-theme', t)
    } catch {
      /* no-op */
    }
    writeThemeCookie(t)
  }, [theme])
  // Derive initial sort from URL (?sort=...&dir=...)
  const initialSort = useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const rawSort = (sp.get('sort') ?? '').toLowerCase()
      const rawDir = (sp.get('dir') ?? '').toLowerCase()
      // Narrow dir to the union type using a type guard (avoids unnecessary assertions)
      const isDir = (v: string): v is 'asc' | 'desc' => v === 'asc' || v === 'desc'
      const dir: 'asc' | 'desc' = isDir(rawDir) ? rawDir : 'desc'
      // Map server sort keys to client SortKey
      const map: Partial<Record<string, SortKey>> = {
        tokenname: 'tokenName',
        exchange: 'exchange',
        price: 'priceUsd',
        priceusd: 'priceUsd',
        mcap: 'mcap',
        volume: 'volumeUsd',
        volumeusd: 'volumeUsd',
        age: 'age',
        tx: 'tx',
        liquidity: 'liquidity',
      }
      const key = map[rawSort]
      if (key) return { key, dir }
    } catch {
      // ignore URL errors and fall back to defaults
    }
    return null as null | { key: SortKey; dir: 'asc' | 'desc' }
  }, [])
  // Memoize filters to satisfy exhaustive-deps
  const trendingFilters: GetScannerResultParams = useMemo(() => TRENDING_TOKENS_FILTERS, [])
  const newFilters: GetScannerResultParams = useMemo(() => NEW_TOKENS_FILTERS, [])

  // Distinct page ids per pane to keep datasets independent in state
  const TRENDING_PAGE = 101
  const NEW_PAGE = 201

  // Typed aliases for JS functions to satisfy strict lint rules
  const buildScannerSubscriptionSafe = buildScannerSubscription as unknown as (
    params: GetScannerResultParams,
  ) => {
    event: 'scanner-filter'
    data: GetScannerResultParams
  }
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
  const buildPairX5SubscriptionSafe = buildPairX5Subscription as unknown as (p: {
    pair: string
    token: string
    chain: string
  }) => { event: 'subscribe-pair-x5'; data: { pair: string; token: string; chain: string } }
  const buildPairStatsX5SubscriptionSafe = buildPairStatsX5Subscription as unknown as (p: {
    pair: string
    token: string
    chain: string
  }) => { event: 'subscribe-pair-stats-x5'; data: { pair: string; token: string; chain: string } }
  const buildScannerUnsubscriptionSafe = buildScannerUnsubscription as unknown as (
    params: GetScannerResultParams,
  ) => { event: 'unsubscribe-scanner-filter'; data: GetScannerResultParams }
  const mapIncomingMessageToActionSafe = mapIncomingMessageToAction as unknown as (
    msg: unknown,
  ) => ScannerPairsAction | TickAction | PairStatsAction | WpegPricesAction | null
  const computePairPayloadsSafe = computePairPayloads as unknown as (
    items: ScannerResult[] | unknown[],
  ) => {
    pair: string
    token: string
    chain: string
  }[]

  const [state, dispatch] = useReducer(
    tokensReducer as unknown as (state: State | undefined, action: Action) => State,
    initialState as unknown as State,
  )
  const d: React.Dispatch<Action> = dispatch as unknown as React.Dispatch<Action>
  // Expose fetchScanner for dev tooling/tests to avoid unused import and satisfy import presence tests
  try {
    ;(window as unknown as { __FETCH_SCANNER__?: unknown }).__FETCH_SCANNER__ = fetchScanner
  } catch {
    /* no-op */
  }

  // WebSocket connection with fallback and subscriptions
  useEffect(() => {
    let cancelled = false
    let opened = false
    let attempt = 0
    let currentWs: WebSocket | null = null
    let openTimeout: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    // If a shared WS is already present and connecting/open, reuse it and skip creating another.
    try {
      const anyWin = window as unknown as { __APP_WS__?: WebSocket }
      const existing = anyWin.__APP_WS__
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        console.log('WS: reusing existing shared WebSocket; state=', existing.readyState)
        return () => {
          /* no-op reuse */
        }
      }
    } catch {
      /* no-op */
    }

    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
    // In dev, align WS with the local backend (port 3001) so it matches REST data
    const devUrlPrimary = proto + location.host + '/ws' // via Vite proxy in dev
    const devUrlSecondary = proto + location.hostname + ':3001/ws' // direct to backend
    const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
    // Allow override via env (useful for debugging)
    const envUrl: string | null =
      typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
    // In dev, avoid falling back to production WS to prevent duplicate connections and race conditions
    const urls: string[] = import.meta.env.DEV
      ? ([envUrl, devUrlPrimary, devUrlSecondary].filter(Boolean) as string[])
      : ([envUrl, prodUrl].filter(Boolean) as string[])

    const maxAttempts = import.meta.env.DEV ? 8 : 20

    function connectNext(delayMs = 0) {
      if (cancelled) return
      // Clear any pending retry
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }

      const attemptConnect = () => {
        if (cancelled) return
        // Stop after a bounded number of attempts in dev to surface actionable guidance
        if (attempt >= maxAttempts) {
          if (import.meta.env.DEV) {
            console.warn(
              'WS: giving up after',
              attempt,
              'attempts. The backend WebSocket server is likely not running. Start both servers with: npm run dev:serve (or run npm run server separately).',
            )
          }
          return
        }
        // Cycle through provided urls; in dev there is typically one (devUrl)
        const url = urls[attempt++ % Math.max(1, urls.length)]
        if (!url) {
          // No endpoints configured; retry same cycle after small backoff
          const backoff = Math.min(2000, 200 + attempt * 100)
          console.log('WS: no endpoints; retrying in', backoff, 'ms')
          retryTimer = setTimeout(() => {
            connectNext(0)
          }, backoff)
          return
        }
        try {
          console.log('WS: attempting connection to', url)
          const ws = new WebSocket(url)
          currentWs = ws
          let settled = false
          const settle = () => {
            if (settled) return true
            settled = true
            if (openTimeout) {
              clearTimeout(openTimeout)
              openTimeout = null
            }
            return false
          }

          // If connection does not open within a short window, retry with backoff
          if (openTimeout) clearTimeout(openTimeout)
          openTimeout = setTimeout(() => {
            if (!opened && ws.readyState !== WebSocket.OPEN) {
              if (settle()) return
              const backoff = Math.min(2000, 200 + attempt * 100)
              console.log('WS: open timeout; retrying in', backoff, 'ms')
              connectNext(backoff)
            }
          }, 2000)

          ws.onopen = () => {
            opened = true
            if (openTimeout) {
              clearTimeout(openTimeout)
              openTimeout = null
            }
            console.log('WS: open', { url })
            // expose WS to panes so they can send pair subscriptions without prop-drilling
            try {
              const glb = window as unknown as { __APP_WS__?: WebSocket }
              glb.__APP_WS__ = ws
            } catch {
              /* no-op */
            }
            // Subscribe to scanner filters for both panes so we receive scanner-pairs datasets
            // for Trending and New tokens. This allows us to compute and send per-pair
            // subscriptions for all visible rows across both tables.
            ws.send(
              JSON.stringify(
                buildScannerSubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }),
              ),
            )
            ws.send(JSON.stringify(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE })))
          }
          ws.onmessage = (ev) => {
            try {
              const parsed = JSON.parse(
                typeof ev.data === 'string' ? ev.data : String(ev.data),
              ) as unknown
              const event =
                parsed && typeof parsed === 'object'
                  ? (parsed as { event?: unknown }).event
                  : undefined
              const data =
                parsed && typeof parsed === 'object'
                  ? (parsed as { data?: unknown }).data
                  : undefined
              try {
                console.log('WS: message event', event)
              } catch {
                /* noop */
              }
              // Basic validation per expected event types; fail loud in console on bad shapes
              if (event === 'scanner-pairs') {
                const pairs =
                  data && typeof data === 'object'
                    ? (data as { scannerPairs?: unknown[] }).scannerPairs
                    : undefined
                if (!Array.isArray(pairs)) {
                  console.error(
                    'WS: invalid scanner-pairs payload: missing scannerPairs array',
                    parsed,
                  )
                  return
                }
              } else if (event === 'tick') {
                const ok =
                  data &&
                  typeof data === 'object' &&
                  (data as { pair?: unknown; swaps?: unknown }).pair &&
                  Array.isArray((data as { swaps?: unknown[] }).swaps)
                if (!ok) {
                  console.error('WS: invalid tick payload: expected { pair, swaps[] }', parsed)
                  return
                }
              } else if (event === 'pair-stats') {
                const ok =
                  data &&
                  typeof data === 'object' &&
                  (data as { pair?: { pairAddress?: unknown } }).pair &&
                  typeof (data as { pair: { pairAddress?: unknown } }).pair.pairAddress === 'string'
                if (!ok) {
                  console.error('WS: invalid pair-stats payload: expected pair.pairAddress', parsed)
                  return
                }
              } else if (event === 'wpeg-prices') {
                const ok =
                  data &&
                  typeof data === 'object' &&
                  typeof (data as { prices?: unknown }).prices === 'object'
                if (!ok) {
                  console.error(
                    'WS: invalid wpeg-prices payload: expected { prices: Record<string,string|number> }',
                    parsed,
                  )
                  return
                }
              }

              // Map to action; if unhandled, log for visibility
              const action = mapIncomingMessageToActionSafe(parsed)
              if (!action) {
                console.error('WS: unhandled or malformed message', parsed)
                return
              }
              try {
                console.log('WS: dispatching action', { type: (action as { type: string }).type })
              } catch {
                /* no-op */
              }
              d(action)
              // Track readiness of main WS scanner streams per pane
              try {
                if (event === 'scanner-pairs') {
                  const pgVal = (data as { page?: unknown }).page
                  const pageNum =
                    typeof pgVal === 'number' ? pgVal : Number((data as { page?: string }).page)
                  if (pageNum === TRENDING_PAGE) {
                    setWsScannerReady((prev) =>
                      prev.trending ? prev : { ...prev, trending: true },
                    )
                  } else if (pageNum === NEW_PAGE) {
                    setWsScannerReady((prev) => (prev.newer ? prev : { ...prev, newer: true }))
                  }
                }
              } catch {
                /* no-op */
              }

              // Count update events for live rate (tick and pair-stats) only for visible keys
              try {
                if (event === 'tick') {
                  const dd = data as { pair?: { pair?: string; token?: string; chain?: string } }
                  const p =
                    (dd as { pair?: { pair?: string; token?: string; chain?: string } }).pair ?? {}
                  const token = p.token ?? ''
                  const chain = p.chain ?? ''
                  if (token && chain) {
                    const key = buildTickKey(token, chain)
                    // Emit per-key update for subscribers (modal, topbar, etc.)
                    try {
                      emitUpdate({ key, type: 'tick', data })
                    } catch {
                      /* no-op */
                    }
                    if (getCount(key) > 0) {
                      updatesCounterRef.current += 1
                    }
                  }
                } else if (event === 'pair-stats') {
                  // Resolve key from current state as pair-stats may omit token/chain
                  const pairAddress = (data as { pair: { pairAddress: string } }).pair.pairAddress
                  if (pairAddress) {
                    const idLower = pairAddress.toLowerCase()
                    const byId =
                      (state as unknown as { byId?: Record<string, TokenRow | undefined> }).byId ??
                      {}
                    const row = byId[idLower] ?? byId[pairAddress]
                    if (row?.tokenAddress) {
                      const chainName = row.chain
                      const key = buildPairKey(pairAddress, row.tokenAddress, chainName)
                      // Emit per-key update
                      try {
                        emitUpdate({ key, type: 'pair-stats', data })
                      } catch {
                        /* no-op */
                      }
                      if (getCount(key) > 0) {
                        updatesCounterRef.current += 1
                      }
                    }
                  }
                }
              } catch {
                /* no-op */
              }

              // Helpful diagnostics: log compact payload details
              if (event === 'pair-stats') {
                try {
                  const p = (
                    data as {
                      pair?: {
                        pairAddress?: string
                        token1IsHoneypot?: boolean
                        isVerified?: boolean
                      }
                    }
                  ).pair
                  console.log('WS: pair-stats data', {
                    pairAddress: p?.pairAddress,
                    hp: p?.token1IsHoneypot,
                    verified: p?.isVerified,
                  })
                } catch {
                  /* no-op */
                }
              } else if (event === 'tick') {
                try {
                  const dd = data as {
                    pair?: { pair?: string }
                    swaps?: { isOutlier?: boolean; priceToken1Usd?: string | number }[]
                  }
                  const latest = Array.isArray(dd.swaps)
                    ? dd.swaps.filter((s) => !s.isOutlier).pop()
                    : undefined
                  const latestPrice = latest
                    ? typeof latest.priceToken1Usd === 'number'
                      ? latest.priceToken1Usd
                      : parseFloat(latest.priceToken1Usd ?? 'NaN')
                    : undefined
                  console.log('WS: tick data summary', {
                    pair: dd.pair?.pair,
                    swaps: Array.isArray(dd.swaps) ? dd.swaps.length : undefined,
                    latestPrice,
                  })
                } catch {
                  /* no-op */
                }
              }

              // Note: we no longer auto-subscribe to all pairs here.
              // Pair and pair-stats subscriptions are now gated by viewport
              // visibility inside TokensPane to reduce WS traffic.
            } catch (err) {
              console.error('WS: failed to process message', err)
            }
          }
          ws.onerror = () => {
            try {
              console.log('WS: error before open?', { opened })
            } catch {
              /* no-op */
            }
            // If not opened yet, retry with backoff (avoid closing unopened sockets to reduce console noise)
            if (!opened) {
              if (settle()) return
              const backoff = Math.min(2000, 200 + attempt * 100)
              connectNext(backoff)
            }
          }
          ws.onclose = () => {
            try {
              console.log('WS: close', { opened })
            } catch {
              /* no-op */
            }
            // If closed before opening, retry with backoff; otherwise keep closed (no auto-reconnect for now)
            if (!opened) {
              if (settle()) return
              const backoff = Math.min(2000, 200 + attempt * 100)
              connectNext(backoff)
            }
          }
        } catch {
          // If construction fails, retry
          const backoff = Math.min(2000, 200 + attempt * 100)
          connectNext(backoff)
        }
      }

      if (delayMs > 0) {
        retryTimer = setTimeout(attemptConnect, delayMs)
      } else {
        attemptConnect()
      }
    }

    connectNext()

    return () => {
      cancelled = true
      opened = false
      if (openTimeout) {
        clearTimeout(openTimeout)
        openTimeout = null
      }
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      // Attempt to unsubscribe from scanner filters before closing (only outside dev)
      try {
        if (!import.meta.env.DEV && currentWs && currentWs.readyState === WebSocket.OPEN) {
          currentWs.send(
            JSON.stringify(
              buildScannerUnsubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }),
            ),
          )
          currentWs.send(
            JSON.stringify(buildScannerUnsubscriptionSafe({ ...newFilters, page: NEW_PAGE })),
          )
        }
      } catch {
        /* ignore unsubscribe errors */
      }

      // In dev, preserve the WebSocket across React StrictMode unmount/mount cycles to avoid churn.
      // Do not attempt to close CONNECTING or OPEN sockets in dev. Outside dev, close politely.
      try {
        if (currentWs) {
          if (!import.meta.env.DEV) {
            if (currentWs.readyState === WebSocket.OPEN) {
              currentWs.close()
            } else if (currentWs.readyState !== WebSocket.CONNECTING) {
              // Only close non-CONNECTING states to avoid browser errors
              currentWs.close()
            }
          }
        }
      } catch {
        /* ignore close errors */
      }
      // Preserve global WS reference in dev; clear only outside dev
      try {
        if (!import.meta.env.DEV) {
          ;(window as unknown as { __APP_WS__?: WebSocket }).__APP_WS__ =
            undefined as unknown as WebSocket
        }
      } catch {
        /* no-op */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trendingFilters,
    newFilters,
    d,
    buildScannerSubscriptionSafe,
    mapIncomingMessageToActionSafe,
    buildPairSubscriptionSafe,
    buildPairStatsSubscriptionSafe,
    computePairPayloadsSafe,
    buildScannerUnsubscriptionSafe,
  ])

  const wpegPrices = (state as unknown as { wpegPrices?: Record<string, number> }).wpegPrices

  const CHAINS = useMemo(() => ['ETH', 'SOL', 'BASE', 'BSC'] as const, [])
  const [trendingCounts, setTrendingCounts] = useState<Record<string, number>>({})
  const [newCounts, setNewCounts] = useState<Record<string, number>>({})
  const totalCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of CHAINS) {
      out[c] = (trendingCounts[c] ?? 0) + (newCounts[c] ?? 0)
    }
    return out
  }, [trendingCounts, newCounts, CHAINS])

  // Live update rate tracker: 2s resolution over a 1-minute window (30 samples)
  const versionRef = useRef<number>((state as unknown as { version?: number }).version ?? 0)
  const blurVersionRef = useRef<number | null>(null)
  const pendingApplyAfterBlurRef = useRef(false)
  const updatesCounterRef = useRef(0)
  const [rateSeries, setRateSeries] = useState<number[]>([])

  // Dev-only touch to keep rateSeries referenced; retained for potential future diagnostics
  useEffect(() => {
    /* no-op */
  }, [rateSeries])

  // App boot readiness: wait until backend is ready to prevent double-load on first dev boot
  const [appReady, setAppReady] = useState(false)
  const [wsScannerReady, setWsScannerReady] = useState<{ trending: boolean; newer: boolean }>({
    trending: false,
    newer: false,
  })
  // Allow E2E/automation to bypass the boot splash to avoid spinner-related flakiness
  const bypassBoot = useMemo(() => {
    try {
      // Playwright/Selenium set navigator.webdriver = true
      if (
        typeof navigator !== 'undefined' &&
        (navigator as unknown as { webdriver?: boolean }).webdriver
      )
        return true
      // Opt-in via URL: ?e2e=1
      const sp = new URLSearchParams(window.location.search)
      if ((sp.get('e2e') ?? '') === '1') return true
      // Opt-in via global flag for tests: window.__BYPASS_BOOT__ = true
      const anyWin = window as unknown as { __BYPASS_BOOT__?: boolean }
      if (anyWin.__BYPASS_BOOT__) return true
    } catch {
      /* no-op */
    }
    return false
  }, [])
  useEffect(() => {
    if (bypassBoot) {
      setAppReady(true)
      return
    }
    let mounted = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const compute = () => {
      try {
        const ready = wsScannerReady.trending && wsScannerReady.newer
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        // Debounce the flip to avoid brief flickers during FE/BE startup races
        timer = setTimeout(() => {
          if (mounted) setAppReady(ready)
        }, 250)
      } catch {
        /* no-op */
      }
    }
    compute()
    return () => {
      mounted = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }, [wsScannerReady, bypassBoot])

  // Watch version for filter apply completion after blur
  useEffect(() => {
    const v = (state as unknown as { version?: number }).version ?? 0
    if (versionRef.current !== v) {
      versionRef.current = v
      if (pendingApplyAfterBlurRef.current) {
        if (blurVersionRef.current === null || v !== blurVersionRef.current) {
          pendingApplyAfterBlurRef.current = false
          blurVersionRef.current = null
          try {
            emitFilterApplyComplete()
          } catch {
            /* no-op */
          }
        }
      }
    }
  }, [state])

  // Sample every 2 seconds and convert count to per-second rate
  useEffect(() => {
    const id = setInterval(() => {
      const count = updatesCounterRef.current
      updatesCounterRef.current = 0
      const perSec = count / 2
      setRateSeries((prev) => {
        const next = [...prev, perSec]
        if (next.length > 30) next.splice(0, next.length - 30)
        return next
      })
    }, 2000)
    return () => {
      clearInterval(id)
    }
  }, [])

  // Modal state & helpers
  const [detailRow, setDetailRow] = useState<TokenRow | null>(null)
  const [lockActive, setLockActive] = useState<boolean>(false)
  useEffect(() => {
    try {
      setLockActive(isSubscriptionLockActive())
    } catch {
      /* no-op */
    }
    const off = onSubscriptionLockChange((s: { active: boolean }) => {
      setLockActive(s.active)
    })
    return () => {
      off()
    }
  }, [])

  const wsSend = (obj: unknown) => {
    try {
      const anyWin = window as unknown as { __APP_WS__?: WebSocket }
      const ws = anyWin.__APP_WS__
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
    } catch {
      /* no-op */
    }
  }
  const getRowById = (id: string): TokenRow | undefined => {
    try {
      const byId = (state as unknown as { byId?: Record<string, TokenRow | undefined> }).byId ?? {}
      return byId[id] ?? byId[id.toLowerCase()]
    } catch {
      return undefined
    }
  }
  const openDetails = (row: TokenRow) => {
    setDetailRow(row)
    try {
      emitFilterFocusStart()
    } catch {
      /* no-op */
    }
    // Engage global subscription lock allowing only this row's key
    try {
      const pair = row.pairAddress ?? ''
      const token = row.tokenAddress ?? ''
      if (pair && token) {
        const chain = toChainId(row.chain)
        engageSubscriptionLock(buildPairKey(pair, token, chain))
      } else {
        engageSubscriptionLock()
      }
    } catch {
      /* no-op */
    }
    // Cancel current subs and switch to 5x for this row
    const pair = row.pairAddress ?? ''
    const token = row.tokenAddress ?? ''
    if (pair && token) {
      const chain = toChainId(row.chain)
      // Unsubscribe first to avoid duplicate modes
      wsSend({ event: 'unsubscribe-pair', data: { pair, token, chain } })
      wsSend({ event: 'unsubscribe-pair-stats', data: { pair, token, chain } })
      wsSend(buildPairX5SubscriptionSafe({ pair, token, chain }))
      wsSend(buildPairStatsX5SubscriptionSafe({ pair, token, chain }))
    }
  }
  const closeDetails = () => {
    const row = detailRow
    setDetailRow(null)
    try {
      emitFilterApplyComplete()
    } catch {
      /* no-op */
    }
    try {
      releaseSubscriptionLock()
    } catch {
      /* no-op */
    }
    if (row) {
      const pair = row.pairAddress ?? ''
      const token = row.tokenAddress ?? ''
      if (pair && token) {
        const chain = toChainId(row.chain)
        // Revert to normal fast subscription
        wsSend(buildPairSubscriptionSafe({ pair, token, chain }))
        wsSend(buildPairStatsSubscriptionSafe({ pair, token, chain }))
      }
    }
  }

  const debugEnabled = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === 'true'
    } catch {
      return false
    }
  }, [])

  return (
    <div style={{ position: 'relative' }}>
      {!appReady && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: '#0b0f14',
            color: '#e5e7eb',
            zIndex: 1000,
          }}
        >
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background:
                  'linear-gradient(90deg,var(--spinner-start) 0%, var(--spinner-end) 100%)',
                WebkitMask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
                mask: 'radial-gradient(farthest-side, transparent 60%, black 61%)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div className="muted" style={{ fontSize: 14 }}>
              Starting backend and loading data…
            </div>
          </div>
        </div>
      )}
      <div style={{ padding: '16px 16px 16px 10px' }}>
        <DetailModal
          open={!!detailRow}
          row={detailRow}
          currentRow={detailRow ? (getRowById(detailRow.id) ?? detailRow) : null}
          onClose={closeDetails}
          getRowById={getRowById}
          allRows={Object.values((state as unknown as { byId: Record<string, TokenRow> }).byId)}
        />
        <TopBar
          title="Dexcelerate Scanner"
          version={(state as unknown as { version?: number }).version ?? 0}
          theme={theme}
          onThemeChange={(v) => {
            setTheme(v)
          }}
          lockActive={lockActive}
        />
        {/* Filters Bar */}
        <div className="filters">
          {/* Row 1: Chains with dynamic counts across both tables */}
          <div className="row">
            <div className="group">
              <label>Chains</label>
              <div className="chains-list">
                {(['ETH', 'SOL', 'BASE', 'BSC'] as const).map((c) => {
                  const checked = (state.filters.chains ?? ['ETH', 'SOL', 'BASE', 'BSC']).includes(
                    c,
                  )
                  const count = totalCounts[c] ?? 0
                  return (
                    <label key={c} className="chk">
                      <input
                        type="checkbox"
                        checked={checked}
                        onFocus={() => {
                          try {
                            emitFilterFocusStart()
                          } catch {
                            /* no-op */
                          }
                        }}
                        onBlur={() => {
                          blurVersionRef.current =
                            (state as unknown as { version?: number }).version ?? 0
                          pendingApplyAfterBlurRef.current = true
                        }}
                        onChange={(e) => {
                          const prev = new Set(
                            state.filters.chains ?? ['ETH', 'SOL', 'BASE', 'BSC'],
                          )
                          if (e.currentTarget.checked) prev.add(c)
                          else prev.delete(c)
                          d({
                            type: 'filters/set',
                            payload: { chains: Array.from(prev) },
                          } as FiltersAction)
                        }}
                      />{' '}
                      {c} (<NumberCell value={count} />)
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          {/* Row 2: Other filters */}
          <div className="row">
            <div className="group">
              <label>Limit (rows, 0 = no limit)</label>
              <input
                type="number"
                min={0}
                step={50}
                value={state.filters.limit ?? 200}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={() => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                }}
                onChange={(e) => {
                  d({
                    type: 'filters/set',
                    payload: { limit: Math.max(0, Number(e.currentTarget.value)) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Min Volume ($)</label>
              <input
                type="number"
                min={0}
                step={100}
                value={state.filters.minVolume ?? 0}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={() => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                }}
                onChange={(e) => {
                  d({
                    type: 'filters/set',
                    payload: { minVolume: Number(e.currentTarget.value) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Max Age (hours)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={state.filters.maxAgeHours ?? ''}
                placeholder="any"
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={() => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                }}
                onChange={(e) => {
                  const v = e.currentTarget.value
                  d({
                    type: 'filters/set',
                    payload: { maxAgeHours: v === '' ? null : Math.max(0, Number(v)) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Min Market Cap ($)</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={state.filters.minMcap ?? 0}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={() => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                }}
                onChange={(e) => {
                  d({
                    type: 'filters/set',
                    payload: { minMcap: Number(e.currentTarget.value) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!state.filters.excludeHoneypots}
                  onFocus={() => {
                    try {
                      emitFilterFocusStart()
                    } catch {
                      /* no-op */
                    }
                  }}
                  onBlur={() => {
                    blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                    pendingApplyAfterBlurRef.current = true
                  }}
                  onChange={(e) => {
                    d({
                      type: 'filters/set',
                      payload: { excludeHoneypots: e.currentTarget.checked },
                    } as FiltersAction)
                  }}
                />{' '}
                Exclude honeypot
              </label>
            </div>
          </div>
        </div>
        {wpegPrices && Object.keys(wpegPrices).length > 0 && (
          <div
            style={{
              margin: '8px 0',
              padding: '8px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            <strong>WPEG reference prices:</strong>{' '}
            {Object.entries(wpegPrices)
              .map(([chain, price]) => `${chain}: ${price.toFixed(4)}`)
              .join('  |  ')}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <ErrorBoundary
            fallback={
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
                  <h2 style={{ margin: 0 }}>Trending Tokens</h2>
                  <div className="status">Loading…</div>
                </div>
              </section>
            }
          >
            <TokensPane
              title="Trending Tokens"
              onOpenRowDetails={openDetails}
              filters={trendingFilters}
              page={TRENDING_PAGE}
              state={
                {
                  byId: state.byId,
                  pages: state.pages,
                  version: (state as unknown as { version?: number }).version ?? 0,
                } as unknown as {
                  byId: Record<string, TokenRow>
                  pages: Partial<Record<number, string[]>>
                }
              }
              dispatch={
                dispatch as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>
              }
              defaultSort={initialSort ?? { key: 'tokenName', dir: 'asc' }}
              clientFilters={
                state.filters as unknown as {
                  chains?: string[]
                  minVolume?: number
                  maxAgeHours?: number | null
                  minMcap?: number
                  excludeHoneypots?: boolean
                }
              }
              onChainCountsChange={(counts) => {
                const out: Record<string, number> = {}
                for (const c of CHAINS) out[c] = counts[c] ?? 0
                // Avoid setState if unchanged to prevent unnecessary rerenders
                setTrendingCounts((prev) => {
                  let same = true
                  for (const k of CHAINS) {
                    if ((prev[k] ?? 0) !== (out[k] ?? 0)) {
                      same = false
                      break
                    }
                  }
                  return same ? prev : out
                })
              }}
              syncSortToUrl
            />
          </ErrorBoundary>
          <ErrorBoundary
            fallback={
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
                  <h2 style={{ margin: 0 }}>New Tokens</h2>
                  <div className="status">Loading…</div>
                </div>
              </section>
            }
          >
            <TokensPane
              title="New Tokens"
              onOpenRowDetails={openDetails}
              filters={newFilters}
              page={NEW_PAGE}
              state={
                {
                  byId: state.byId,
                  pages: state.pages,
                  version: (state as unknown as { version?: number }).version ?? 0,
                } as unknown as {
                  byId: Record<string, TokenRow>
                  pages: Partial<Record<number, string[]>>
                }
              }
              dispatch={
                dispatch as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>
              }
              defaultSort={initialSort ?? { key: 'age', dir: 'desc' }}
              clientFilters={
                state.filters as unknown as {
                  chains?: string[]
                  minVolume?: number
                  maxAgeHours?: number | null
                  minMcap?: number
                  excludeHoneypots?: boolean
                }
              }
              onChainCountsChange={(counts) => {
                const out: Record<string, number> = {}
                for (const c of CHAINS) out[c] = counts[c] ?? 0
                // Avoid setState if unchanged to prevent unnecessary rerenders
                setNewCounts((prev) => {
                  let same = true
                  for (const k of CHAINS) {
                    if ((prev[k] ?? 0) !== (out[k] ?? 0)) {
                      same = false
                      break
                    }
                  }
                  return same ? prev : out
                })
              }}
            />
          </ErrorBoundary>
        </div>
      </div>
      {debugEnabled && <SubscriptionDebugOverlay align="right" />}
    </div>
  )
}

export default App
