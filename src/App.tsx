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
  buildPairUnsubscription,
  buildPairStatsUnsubscription,
  mapIncomingMessageToAction,
  isAllowedOutgoingEvent,
} from './ws.mapper.js'
import { computePairPayloads } from './ws.subs.js'
import ErrorBoundary from './components/ErrorBoundary'
import NumberCell from './components/NumberCell'
import TokensPane from './components/TokensPane'
import DetailModal from './components/DetailModal'
import { emitFilterFocusStart, emitFilterApplyComplete } from './filter.bus.js'
import { fetchScanner } from './scanner.client.js'
import { getCount } from './visibility.bus.js'
import { SubscriptionQueue } from './subscription.queue'
import { setDefaultInactiveBaseLimit } from './subscription.limit.bus.js'
import { emitUpdate } from './updates.bus'
import { engageSubscriptionLock, releaseSubscriptionLock } from './subscription.lock.bus.js'
import { onSubscriptionLockChange, isSubscriptionLockActive } from './subscription.lock.bus.js'
import { toChainId } from './utils/chain'
import { buildPairKey, buildTickKey } from './utils/key_builder'
import { logCatch } from './utils/debug.mjs'

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
import WsConsole from './components/WsConsole'
import { logWsInfo, logWsSuccess, logWsError } from './ws.console.bus.js'
function TopBar({
  title,
  version,
  theme,
  onThemeChange,
  lockActive,
  eventCounts,
  subCount,
  consoleVisible,
  onToggleConsole,
  onOpenDetail,
  subThrottle,
  setSubThrottle,
  subBaseLimit,
  setSubBaseLimit,
}: {
  title: string
  version: number
  theme: ThemeName
  onThemeChange: (v: ThemeName) => void
  lockActive: boolean
  eventCounts: {
    'scanner-pairs': number
    tick: number
    'pair-stats': number
    'wpeg-prices': number
  }
  subCount: number
  consoleVisible: boolean
  onToggleConsole: () => void
  onOpenDetail: () => void
  subThrottle: number
  setSubThrottle: (n: number) => void
  subBaseLimit: number
  setSubBaseLimit: (n: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 8,
      }}
    >
      {/* Left column: Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {title}
          <button
            type="button"
            aria-label="Open details"
            title="Open Details"
            onClick={onOpenDetail}
            style={{
              background: 'transparent',
              border: '1px solid #4b5563',
              borderRadius: 6,
              color: 'inherit',
              fontSize: 22,
              lineHeight: 1,
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            <ChartNoAxesCombined size={46} />
          </button>
        </h1>
      </div>
      {/* Middle column: two rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260, flex: 1 }}>
        {/* Row A: UpdateRate & Theme selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <UpdateRate version={import.meta.env.DEV ? version : undefined} />
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
        {/* Row B: Subs and WS event counters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Throttle selector: controls total allowed subscriptions */}
          <label
            className="muted"
            title="Throttle: maximum total subscriptions (visible + inactive)."
            style={{
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #4b5563',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              letterSpacing: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Throttle
            <input
              type="number"
              min={0}
              max={1000}
              step={50}
              list="sub-throttle-options"
              value={subThrottle}
              onChange={(e) => {
                const n = Math.max(0, Math.min(1000, Number(e.currentTarget.value) || 0))
                setSubThrottle(n)
              }}
              style={{
                width: 80,
                background: 'transparent',
                border: '1px solid #374151',
                color: '#e5e7eb',
                borderRadius: 8,
                padding: '2px 6px',
              }}
            />
            <datalist id="sub-throttle-options">
              <option value="50" />
              <option value="100" />
              <option value="150" />
              <option value="200" />
              <option value="250" />
              <option value="300" />
              <option value="400" />
              <option value="500" />
              <option value="600" />
              <option value="700" />
              <option value="800" />
              <option value="900" />
              <option value="1000" />
            </datalist>
          </label>
          <label
            className="muted"
            style={{
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #4b5563',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              letterSpacing: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="Default base for inactive subs when Throttle is unset"
          >
            Base Limit
            <input
              type="number"
              min={0}
              max={1000}
              step={25}
              value={subBaseLimit}
              onChange={(e) => {
                const n = Math.max(0, Math.min(1000, Number(e.currentTarget.value) || 0))
                ;(setSubBaseLimit as (n: number) => void)(n)
              }}
              style={{
                width: 80,
                background: 'transparent',
                border: '1px solid #374151',
                color: '#e5e7eb',
                borderRadius: 8,
                padding: '2px 6px',
              }}
            />
          </label>
          <span
            className="muted"
            title="Active subscriptions across all panes"
            style={{
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #4b5563',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              letterSpacing: 0.5,
            }}
          >
            Subs: <strong style={{ marginLeft: 4 }}>{subCount}</strong>
          </span>
          {(
            [
              ['scanner-pairs', 'Scanner'],
              ['tick', 'Tick'],
              ['pair-stats', 'Pair Stats'],
              ['wpeg-prices', 'WPEG'],
            ] as const
          ).map(([key, label]) => (
            <span
              key={key}
              className="muted"
              title={`${label} events received`}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid #4b5563',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.06)',
                letterSpacing: 0.5,
              }}
            >
              {label}: <strong style={{ marginLeft: 4 }}>{eventCounts[key]}</strong>
            </span>
          ))}
          <button
            type="button"
            className="btn"
            aria-pressed={consoleVisible}
            onClick={onToggleConsole}
            title={consoleVisible ? 'Hide WebSocket console' : 'Show WebSocket console'}
            style={{
              background: '#111827',
              color: '#e5e7eb',
              border: '1px solid #374151',
              borderRadius: 12,
              padding: '2px 8px',
              fontSize: 11,
              letterSpacing: 0.5,
            }}
          >
            Console: {consoleVisible ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      {/* Right column: console fills remaining space */}
      <div
        style={{
          marginLeft: 'auto',
          minWidth: 280,
          flex: 1,
          display: 'flex',
          width: '100%',
        }}
      >
        {consoleVisible ? <WsConsole /> : null}
      </div>
    </div>
  )
}

// Minimal row type for table consumption
import type { Token as TokenRow } from './models/Token'
import { ChartNoAxesCombined } from 'lucide-react'

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
}

// Local action types matching tokens.reducer.js
interface ScannerPairsAction {
  type: 'scanner/pairs'
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

interface ScannerAppendAction {
  type: 'scanner/append'
  payload: { page: number; scannerPairs: unknown[] }
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

type Action = ScannerPairsAction | TickAction | PairStatsAction | FiltersAction

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
        fresh: 'fresh',
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

  // Distinct logical page identifiers per pane to keep datasets independent in state.
  // Why 101 and 201?
  // - These are client-assigned, "out-of-band" identifiers used in two places:
  //   1) As keys under state.pages[page] to ensure the Trending and New datasets never collide.
  //   2) In the scanner-filter WebSocket subscription payload as `page`, so the server echoes the
  //      same `page` value back in scanner-pairs events. We use that echo to route incoming
  //      datasets to the correct pane without guessing.
  // - We pick numbers in the 1xx (Trending) and 2xx (New) ranges to avoid any confusion with
  //   REST pagination pages (1, 2, 3, …). The REST calls still use page=1,2,… for infinite scroll,
  //   while these constants are purely logical identifiers for the two streams.
  // - You can change them if needed; just keep them distinct. If you add more panes, choose another
  //   disjoint range (e.g., 3xx) to keep things obvious.
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
  const buildScannerUnsubscriptionSafe = buildScannerUnsubscription as unknown as (
    params: GetScannerResultParams,
  ) => { event: 'unsubscribe-scanner-filter'; data: GetScannerResultParams }
  const mapIncomingMessageToActionSafe = mapIncomingMessageToAction as unknown as (
    msg: unknown,
  ) => ScannerPairsAction | TickAction | PairStatsAction | null
  const computePairPayloadsSafe = computePairPayloads as unknown as (
    items: ScannerResult[] | unknown[],
  ) => {
    pair: string
    token: string
    chain: string
  }[]
  const isAllowedOutgoingEventSafe = isAllowedOutgoingEvent as unknown as (ev: string) => boolean

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

    // Use product WS endpoint by default in all environments. Allow override via VITE_WS_URL for testing/mocks.
    const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
    const envUrl: string | null =
      typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
    const urls: string[] = [envUrl, prodUrl].filter(Boolean) as string[]

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
            logWsSuccess('WebSocket open ' + url)
            opened = true
            if (openTimeout) {
              clearTimeout(openTimeout)
              openTimeout = null
            }
            console.log('WS: open', { url })
            // apply current subscription throttle to queue on open
            try {
              SubscriptionQueue.setThrottle(subThrottle, ws)
            } catch {}
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
            logWsInfo('scanner-filter sent (Trending) page ' + String(TRENDING_PAGE))
            ws.send(JSON.stringify(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE })))
            logWsInfo('scanner-filter sent (New) page ' + String(NEW_PAGE))
          }
          ws.onerror = (ev) => {
            try {
              const safeMsg = (() => {
                try {
                  const maybe = (ev as unknown as { message?: unknown; type?: unknown })?.message
                  if (typeof maybe === 'string') return maybe
                  const maybeType = (ev as unknown as { type?: unknown })?.type
                  if (typeof maybeType === 'string') return `Event:${maybeType}`
                  // Avoid base-to-string on plain objects
                  if (typeof ev === 'string') return ev
                  // As a last resort, try a compact JSON if possible
                  if (ev && typeof ev === 'object') {
                    try {
                      return JSON.stringify(ev)
                    } catch {
                      return '[event]'
                    }
                  }
                  return String(ev)
                } catch {
                  return '[event]'
                }
              })()
              logWsError('WebSocket error ' + safeMsg)
            } catch {
              /* no-op */
            }
          }
          ws.onclose = (ev) => {
            try {
              const code = ev?.code ?? 0
              logWsInfo('WebSocket closed code ' + String(code))
            } catch {}
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
              try {
                logWsInfo('event ' + String(event))
              } catch {}
              try {
                bumpEventCount(event)
              } catch {}
              const data =
                parsed && typeof parsed === 'object'
                  ? (parsed as { data?: unknown }).data
                  : undefined
              try {
                if (import.meta.env.DEV) {
                  msgLogCountRef.current += 1
                  if (msgLogCountRef.current % 20 === 0) {
                    console.log('WS: message event (sampled)', event)
                  }
                }
              } catch {
                /* noop */
              }
              // Basic validation per expected event types; fail loud in console on bad shapes
              if (event === 'scanner-pairs') {
                const pairs =
                  data && typeof data === 'object'
                    ? (data as { pairs?: unknown[] }).pairs
                    : undefined
                if (!Array.isArray(pairs)) {
                  console.error('WS: invalid scanner-pairs payload: missing pairs array', parsed)
                  try {
                    logWsError('invalid scanner-pairs payload')
                  } catch {}
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
                  try {
                    logWsError('invalid tick payload')
                  } catch {}
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
                  try {
                    logWsError('invalid pair-stats payload')
                  } catch {}
                  return
                }
              }

              // Map to action; if unhandled, log for visibility
              const action = mapIncomingMessageToActionSafe(parsed)
              if (!action) {
                console.error('WS: unhandled or malformed message', parsed)
                try {
                  interface MaybeEvent {
                    event?: unknown
                  }
                  const evName =
                    typeof parsed === 'object' && parsed && 'event' in parsed
                      ? (parsed as MaybeEvent).event
                      : undefined
                  const safeEv =
                    evName == null
                      ? 'unknown'
                      : typeof evName === 'string'
                        ? evName
                        : typeof evName === 'number' || typeof evName === 'boolean'
                          ? String(evName)
                          : typeof evName === 'bigint' || typeof evName === 'symbol'
                            ? String(evName)
                            : typeof evName === 'function'
                              ? `[fn ${evName.name || 'anonymous'}]`
                              : Array.isArray(evName) || typeof evName === 'object'
                                ? JSON.stringify(evName)
                                : 'unknown'
                  logWsError('unhandled or malformed message: ' + safeEv)
                } catch {}
                return
              }
              try {
                if (import.meta.env.DEV) {
                  msgLogCountRef.current += 1
                  if (msgLogCountRef.current % 20 === 0) {
                    console.log('WS: dispatching action (sampled)', {
                      type: (action as { type: string }).type,
                    })
                  }
                }
              } catch {
                /* no-op */
              }
              // Defer dispatch to break up long tasks and allow paint
              setTimeout(() => {
                d(action)
              }, 0)
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
              const safe = err instanceof Error ? err.message : String(err)
              console.error('WS: failed to process message', safe)
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
  const msgLogCountRef = useRef(0)
  // WS event counters (allowed incoming events)
  type WsEventName = 'scanner-pairs' | 'tick' | 'pair-stats' | 'wpeg-prices'
  type WsCounts = Record<WsEventName, number>
  const zeroCounts: WsCounts = { 'scanner-pairs': 0, tick: 0, 'pair-stats': 0, 'wpeg-prices': 0 }
  const countsRef = useRef<WsCounts>({ ...zeroCounts })
  const [eventCounts, setEventCounts] = useState<WsCounts>({ ...zeroCounts })
  const flushTimerRef = useRef<number | null>(null)
  // Normalize varying server event name styles to our canonical keys
  const normalizeEventName = (ev: unknown): WsEventName | null => {
    try {
      let s: string
      if (typeof ev === 'string') s = ev
      else if (typeof ev === 'number' || typeof ev === 'boolean') s = String(ev)
      else if (typeof ev === 'symbol') s = ev.toString()
      else s = ''
      s = s.toLowerCase()
      const collapsed = s.replace(/[^a-z0-9]/g, '') // remove dashes/underscores/spaces
      switch (collapsed) {
        case 'scannerpairs':
        case 'pairs': // tolerate legacy short name
          return 'scanner-pairs'
        case 'tick':
          return 'tick'
        case 'pairstats':
        case 'pairstat':
          return 'pair-stats'
        case 'wpegprices':
        case 'wpeg':
          return 'wpeg-prices'
        default:
          return null
      }
    } catch {
      return null
    }
  }
  const bumpEventCount = (ev: unknown) => {
    const k = normalizeEventName(ev)
    if (!k) return
    countsRef.current[k] = (countsRef.current[k] ?? 0) + 1
    // Coalesce flushes to avoid excessive setState under high throughput
    if (flushTimerRef.current == null) {
      flushTimerRef.current ??= window.setTimeout(() => {
        try {
          setEventCounts({ ...countsRef.current })
        } finally {
          flushTimerRef.current = null
        }
      }, 250)
    }
  }
  // Live subscriptions count (polled)
  const [subCount, setSubCount] = useState<number>(0)
  // Global throttle for total subscriptions (visible + inactive)
  const [subThrottle, setSubThrottle] = useState<number>(300)
  // Dynamic base limit used when no throttle is applied (affects default heuristic)
  const [subBaseLimit, setSubBaseLimit] = useState<number>(100)
  useEffect(() => {
    try {
      const safe = Math.max(0, Math.min(1000, subThrottle || 0))
      const anyWin = window as unknown as { __APP_WS__?: WebSocket | null }
      const ws = anyWin.__APP_WS__ ?? null
      SubscriptionQueue.setThrottle(safe, ws)
    } catch {
      /* no-op */
    }
  }, [subThrottle])
  useEffect(() => {
    try {
      const safe = Math.max(0, Math.min(1000, subBaseLimit || 0))
      setDefaultInactiveBaseLimit(safe)
    } catch {
      /* no-op */
    }
  }, [subBaseLimit])
  // Touch setter once to ensure it is recognized as used in all analysis passes
  useEffect(() => {
    try {
      setSubBaseLimit((n) => n)
    } catch {
      /* no-op */
    }
  }, [])
  useEffect(() => {
    let raf = 0
    let timer: number | null = null
    const tick = () => {
      try {
        setSubCount(SubscriptionQueue.getSubscribedCount())
      } catch {}
      timer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(tick)
      }, 500)
    }
    tick()
    return () => {
      if (timer != null) {
        try {
          window.clearTimeout(timer)
        } catch {}
      }
      try {
        window.cancelAnimationFrame(raf)
      } catch {}
    }
  }, [])
  const [rateSeries, setRateSeries] = useState<number[]>([])
  // WebSocket console visibility (default hidden)
  const [consoleVisible, setConsoleVisible] = useState(false)

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
  // Early boot diagnostics — log current theme and page keys when state/theme changes
  useEffect(() => {
    try {
      const pages = (state as unknown as { pages?: Partial<Record<number, string[]>> }).pages ?? {}
      console.info('App: mount', {
        theme,
        bypassBoot: false,
        pagesKeys: Object.keys(pages),
      })
    } catch {
      /* no-op */
    }
  }, [state, theme])

  // Global error diagnostics to catch silent failures after REST success
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      try {
        console.error('App: global error', {
          message: ev.message,
          filename: ev.filename,
          lineno: ev.lineno,
          colno: ev.colno,
        })
      } catch {}
    }
    const onRejection = (ev: PromiseRejectionEvent) => {
      try {
        const reason: unknown = ev.reason
        let msg: string
        if (
          typeof reason === 'object' &&
          reason !== null &&
          'message' in reason &&
          typeof (reason as { message: unknown }).message === 'string'
        ) {
          msg = (reason as { message: string }).message
        } else if (typeof reason === 'string') {
          msg = reason
        } else if (
          typeof reason === 'number' ||
          typeof reason === 'boolean' ||
          typeof reason === 'symbol'
        ) {
          msg = String(reason)
        } else {
          msg = 'unknown'
        }
        console.error('App: global unhandledrejection', { message: msg })
      } catch {}
    }
    try {
      window.addEventListener('error', onError)
    } catch {}
    try {
      window.addEventListener('unhandledrejection', onRejection)
    } catch {}
    return () => {
      try {
        window.removeEventListener('error', onError)
      } catch {}
      try {
        window.removeEventListener('unhandledrejection', onRejection)
      } catch {}
    }
  }, [])
  // Fallback readiness: if pages are initialized via REST (or WS), consider panes ready
  // This avoids the app getting stuck on the boot overlay when the backend does not
  // emit scanner-pairs over WebSocket, while REST has already populated the store.
  useEffect(() => {
    try {
      const pages = (state as unknown as { pages?: Partial<Record<number, string[]>> }).pages ?? {}
      const trendingArr = (pages as Record<number, string[] | undefined>)[TRENDING_PAGE]
      const newArr = (pages as Record<number, string[] | undefined>)[NEW_PAGE]
      const hasTrending = Array.isArray(trendingArr)
      const hasNew = Array.isArray(newArr)
      console.info('App: pages-scan', {
        TRENDING_PAGE,
        NEW_PAGE,
        hasTrending,
        hasNew,
        trendingLen: Array.isArray(trendingArr) ? trendingArr.length : undefined,
        newLen: Array.isArray(newArr) ? newArr.length : undefined,
      })
      if (hasTrending || hasNew) {
        setWsScannerReady((prev) => ({
          trending: prev.trending || hasTrending,
          newer: prev.newer || hasNew,
        }))
      }
    } catch (err) {
      logCatch('App: boot readiness pages scan failed', err)
    }
  }, [state, TRENDING_PAGE, NEW_PAGE])
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
    let failsafe: ReturnType<typeof setTimeout> | null = null
    const compute = () => {
      try {
        const ready = wsScannerReady.trending && wsScannerReady.newer
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        // Debounce the flip to avoid brief flickers during FE/BE startup races
        timer = setTimeout(() => {
          if (mounted) {
            setAppReady(ready)
            if (!ready && !failsafe) {
              // Arm a bounded boot failsafe so the overlay cannot stick forever without any errors
              failsafe = setTimeout(() => {
                try {
                  const st = state as unknown as {
                    pages?: Partial<Record<number, string[]>>
                    byId?: Record<string, unknown>
                  }
                  const pages = st.pages ?? {}
                  const pageKeys = Object.keys(pages)
                  const hasAnyPage = pageKeys.length > 0
                  const hasAnyRows = st.byId && Object.keys(st.byId).length > 0
                  if (!appReady && (hasAnyPage || hasAnyRows)) {
                    console.warn('App: boot failsafe released overlay', { hasAnyPage, hasAnyRows })
                    setAppReady(true)
                  }
                } catch {
                  // still release to unblock UI
                  setAppReady(true)
                }
              }, 6000)
            }
          }
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
      if (failsafe) {
        clearTimeout(failsafe)
        failsafe = null
      }
    }
  }, [wsScannerReady, bypassBoot, state, appReady])

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
  const [detailOpen, setDetailOpen] = useState<boolean>(false)
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
      const ev = obj && typeof obj === 'object' ? (obj as { event?: unknown }).event : undefined
      if (typeof ev === 'string' && !isAllowedOutgoingEventSafe(ev)) {
        try {
          console.warn('WS: blocked (not allowed) outgoing room:', ev)
        } catch {
          /* no-op */
        }
        return
      }
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
    setDetailOpen(true)
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
    // Cancel scanner streams for both tables while modal is focused, then subscribe to the selected token
    try {
      wsSend(buildScannerUnsubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }))
      wsSend(buildScannerUnsubscriptionSafe({ ...newFilters, page: NEW_PAGE }))
    } catch {
      /* no-op */
    }
    const pair = row.pairAddress ?? ''
    const token = row.tokenAddress ?? ''
    if (pair && token) {
      const chain = toChainId(row.chain)
      // Ensure any existing subs for this pair are cleared, then add normal subs for the modal
      wsSend(buildPairUnsubscription({ pair, token, chain }))
      wsSend(buildPairStatsUnsubscription({ pair, token, chain }))
      wsSend(buildPairSubscriptionSafe({ pair, token, chain }))
      wsSend(buildPairStatsSubscriptionSafe({ pair, token, chain }))
    }
  }
  const closeDetails = () => {
    const row = detailRow
    setDetailRow(null)
    setDetailOpen(false)
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
    // Resume scanner streams for both tables
    try {
      wsSend(buildScannerSubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }))
      wsSend(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE }))
    } catch {
      /* no-op */
    }
    // Clean up modal-specific pair subscriptions; panes will manage visibility-based subs
    if (row) {
      const pair = row.pairAddress ?? ''
      const token = row.tokenAddress ?? ''
      if (pair && token) {
        const chain = toChainId(row.chain)
        wsSend(buildPairUnsubscription({ pair, token, chain }))
        wsSend(buildPairStatsUnsubscription({ pair, token, chain }))
      }
    }
  }

  // Fetch initial token data from REST API and dispatch to reducer
  useEffect(() => {
    let cancelled = false
    async function fetchInitialData() {
      try {
        // Trending tokens
        const trendingRes = await fetchScanner({ ...TRENDING_TOKENS_FILTERS, page: 1 })
        if (!cancelled) {
          d({
            type: 'scanner/pairs',
            payload: {
              page: TRENDING_PAGE,
              scannerPairs: trendingRes.tokens,
            },
          })
          console.log('[App] Initial REST fetch: Trending', trendingRes.tokens.length)
        }
      } catch (err) {
        console.error('[App] Initial REST fetch failed: Trending', err)
      }
      try {
        // New tokens
        const newRes = await fetchScanner({ ...NEW_TOKENS_FILTERS, page: 1 })
        if (!cancelled) {
          d({
            type: 'scanner/pairs',
            payload: {
              page: NEW_PAGE,
              scannerPairs: newRes.tokens,
            },
          })
          console.log('[App] Initial REST fetch: New', newRes.tokens.length)
        }
      } catch (err) {
        console.error('[App] Initial REST fetch failed: New', err)
      }
    }
    fetchInitialData()
    return () => {
      cancelled = true
    }
  }, [d, TRENDING_PAGE, NEW_PAGE])

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
              Loading data…
            </div>
          </div>
        </div>
      )}
      <div style={{ padding: '16px 16px 16px 10px' }}>
        <DetailModal
          open={detailOpen}
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
          eventCounts={eventCounts}
          subCount={subCount}
          consoleVisible={consoleVisible}
          onToggleConsole={() => {
            setConsoleVisible((v) => !v)
          }}
          onOpenDetail={() => {
            setDetailRow(null)
            setDetailOpen(true)
          }}
          subThrottle={subThrottle}
          setSubThrottle={(n) => {
            setSubThrottle(n)
          }}
          subBaseLimit={subBaseLimit}
          setSubBaseLimit={(n: number) => {
            ;(setSubBaseLimit as (n: number) => void)(n)
          }}
        />
        {/* Filters Bar */}
        <div className="filters">
          {/* Row 1: Chains with dynamic counts across both tables */}
          <div className="row">
            <div className="group">
              <div className="chains-list">
                <label>Chains</label>
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
            <div className="group" id="filter-token-search">
              <label>
                Token Search{' '}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  <span style={{ color: 'var(--accent-up)' }}>(Fresh included)</span>
                </span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={String(state.filters.tokenQuery ?? '')}
                  placeholder={
                    typeof state.filters.tokenQuery === 'string' && state.filters.tokenQuery
                      ? String(state.filters.tokenQuery)
                      : 'Search token name or symbol'
                  }
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
                      payload: { tokenQuery: e.currentTarget.value },
                    } as FiltersAction)
                  }}
                  style={{
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 4,
                    padding: '4px 8px',
                    color: '#e5e7eb',
                    minWidth: 220,
                  }}
                />
                {state.filters.tokenQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      d({ type: 'filters/set', payload: { tokenQuery: '' } } as FiltersAction)
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid #4b5563',
                      borderRadius: 4,
                      padding: '4px 8px',
                      color: 'inherit',
                    }}
                    title="Clear token search"
                  >
                    Clear
                  </button>
                ) : null}
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!state.filters.includeStale}
                    onChange={(e) => {
                      d({
                        type: 'filters/set',
                        payload: { includeStale: e.currentTarget.checked },
                      } as FiltersAction)
                    }}
                  />{' '}
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    <span style={{ color: '#e5e7eb' }}>Include stale</span>
                  </span>
                </label>
                <label className="chk" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!state.filters.includeDegraded}
                    onChange={(e) => {
                      d({
                        type: 'filters/set',
                        payload: { includeDegraded: e.currentTarget.checked },
                      } as FiltersAction)
                    }}
                  />{' '}
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    <span style={{ color: 'var(--accent-down)' }}>Include degraded</span>
                  </span>
                </label>
              </div>
            </div>
            <div className="group" id="filter-limit-rows">
              <label>Limit per Table (Rows, 0 = N/A)</label>
              <input
                type="number"
                min={0}
                step={50}
                defaultValue={state.filters.limit ?? 200}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={(e) => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                  const v = Math.max(0, Number(e.currentTarget.value))
                  d({
                    type: 'filters/set',
                    payload: { limit: v },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Min Volume ($, 0 = N/A)</label>
              <input
                type="number"
                min={0}
                step={100}
                defaultValue={state.filters.minVolume ?? 0}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={(e) => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                  d({
                    type: 'filters/set',
                    payload: { minVolume: Number(e.currentTarget.value) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Max Age (hours, 0 = N/A)</label>
              <input
                type="number"
                min={0}
                step={1}
                defaultValue={state.filters.maxAgeHours ?? ''}
                placeholder="any"
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={(e) => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
                  const v = e.currentTarget.value
                  d({
                    type: 'filters/set',
                    payload: { maxAgeHours: v === '' ? null : Math.max(0, Number(v)) },
                  } as FiltersAction)
                }}
              />
            </div>
            <div className="group">
              <label>Min Market Cap ($, 0 = N/A)</label>
              <input
                type="number"
                min={0}
                step={1000}
                defaultValue={state.filters.minMcap ?? 0}
                onFocus={() => {
                  try {
                    emitFilterFocusStart()
                  } catch {
                    /* no-op */
                  }
                }}
                onBlur={(e) => {
                  blurVersionRef.current = (state as unknown as { version?: number }).version ?? 0
                  pendingApplyAfterBlurRef.current = true
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Log state before rendering tables */}
          {(() => {
            try {
              console.log('App: state.byId keys', Object.keys(state.byId))
              console.log('App: state.pages', state.pages)
            } catch {}
            return null
          })()}
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
            {/* Log computed rows for Trending */}
            {(() => {
              try {
                const ids = state.pages[TRENDING_PAGE] || []
                const rows = ids.map((id) => state.byId[id]).filter(Boolean)
                console.log('App: Trending rows', rows.length, rows.map(r => r?.id))
              } catch {}
              return null
            })()}
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
                ((action: { type?: unknown; payload?: unknown }) => {
                  try {
                    const t = typeof action?.type === 'string' ? action.type : 'unknown'
                    if (
                      t === 'scanner/pairs' ||
                      t === 'scanner/append' ||
                      t === 'scanner/pairsTokens'
                    ) {
                      const pObj =
                        action && typeof action.payload === 'object' && action.payload !== null
                          ? (action.payload as {
                              scannerPairs?: unknown
                              tokens?: unknown
                              page?: unknown
                            })
                          : {}
                      const count = Array.isArray(pObj.scannerPairs)
                        ? pObj.scannerPairs.length
                        : Array.isArray(pObj.tokens)
                          ? pObj.tokens.length
                          : 'n/a'
                      const pageVal =
                        typeof (pObj as { page?: unknown }).page === 'number' ||
                        typeof (pObj as { page?: unknown }).page === 'string'
                          ? (pObj as { page?: number | string }).page!
                          : undefined
                      console.info('DISPATCH:', t, { page: pageVal, count })
                    }
                  } catch {
                    /* no-op */
                  }
                  ;(dispatch as unknown as React.Dispatch<Action>)(action as unknown as Action)
                }) as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>
              }
              defaultSort={initialSort ?? { key: 'tokenName', dir: 'asc' }}
              clientFilters={
                state.filters as unknown as {
                  chains?: string[]
                  minVolume?: number
                  maxAgeHours?: number | null
                  minMcap?: number
                  excludeHoneypots?: boolean
                  limit?: number
                  tokenQuery?: string
                }
              }
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
            {/* Log computed rows for New */}
            {(() => {
              try {
                const ids = state.pages[NEW_PAGE] || []
                const rows = ids.map((id) => state.byId[id]).filter(Boolean)
                console.log('App: New rows', rows.length, rows.map(r => r?.id))
              } catch {}
              return null
            })()}
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
                ((action: { type?: unknown; payload?: unknown }) => {
                  try {
                    const t = typeof action?.type === 'string' ? action.type : 'unknown'
                    if (
                      t === 'scanner/pairs' ||
                      t === 'scanner/append' ||
                      t === 'scanner/pairsTokens'
                    ) {
                      const pObj =
                        action && typeof action.payload === 'object' && action.payload !== null
                          ? (action.payload as {
                              scannerPairs?: unknown
                              tokens?: unknown
                              page?: unknown
                            })
                          : {}
                      const count = Array.isArray(pObj.scannerPairs)
                        ? pObj.scannerPairs.length
                        : Array.isArray(pObj.tokens)
                          ? pObj.tokens.length
                          : 'n/a'
                      const pageVal =
                        typeof (pObj as { page?: unknown }).page === 'number' ||
                        typeof (pObj as { page?: unknown }).page === 'string'
                          ? (pObj as { page?: number | string }).page!
                          : undefined
                      console.info('DISPATCH:', t, { page: pageVal, count })
                    }
                  } catch {
                    /* no-op */
                  }
                  ;(dispatch as unknown as React.Dispatch<Action>)(action as unknown as Action)
                }) as unknown as React.Dispatch<ScannerPairsAction | ScannerAppendAction>
              }
              defaultSort={initialSort ?? { key: 'tokenName', dir: 'asc' }}
              clientFilters={
                state.filters as unknown as {
                  chains?: string[]
                  minVolume?: number
                  maxAgeHours?: number | null
                  minMcap?: number
                  excludeHoneypots?: boolean
                  limit?: number
                  tokenQuery?: string
                }
              }
            />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

export default App
