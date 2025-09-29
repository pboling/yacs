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
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useCallback,
  startTransition,
} from 'react'
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
  mapIncomingMessageToAction,
  isAllowedOutgoingEvent,
  wsSendSubscribe,
} from './ws.mapper.js'
import { computePairPayloads } from './ws.subs.js'
import ErrorBoundary from './components/ErrorBoundary'
import NumberCell from './components/NumberCell'
import TokensPane from './components/TokensPane'
import DetailModal from './components/DetailModal'
import { emitFilterFocusStart, emitFilterApplyComplete } from './filter.bus.js'
import { fetchScanner } from './scanner.client.js'
import { SubscriptionQueue } from './subscription.queue'
import { setDefaultInvisibleBaseLimit } from './subscription.limit.bus.js'
import { engageSubscriptionLock, releaseSubscriptionLock } from './subscription.lock.bus.js'
import { onSubscriptionLockChange, isSubscriptionLockActive } from './subscription.lock.bus.js'
import { buildPairKey, buildTickKey } from './utils/key_builder'
import { emitUpdate } from './updates.bus'
import { UNSUBSCRIPTIONS_DISABLED } from './ws.mapper.js'
import Toast from './components/Toast'
import { isDebugEnabled } from './utils/debug.mjs'

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
import { debugLog } from './utils/debug.mjs'
function TopBar({
  title,
  version,
  theme,
  onThemeChange,
  lockActive,
  eventCounts,
  subCount,
  invisCount,
  consoleVisible,
  onToggleConsole,
  onOpenDetail,
  subBaseLimit,
  setSubBaseLimit,
  onInject,
  isAutoPlaying,
  onToggleAutoPlay,
  showOverlay,
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
  invisCount: number
  consoleVisible: boolean
  onToggleConsole: () => void
  onOpenDetail: () => void
  subBaseLimit: number
  setSubBaseLimit: (n: number) => void
  onInject: (ev: 'scanner-pairs' | 'tick' | 'pair-stats' | 'wpeg-prices') => void
  isAutoPlaying: boolean
  onToggleAutoPlay: () => void
  showOverlay: boolean
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {title}

          <button
            type="button"
            data-testid={`open-token-compare`}
            title={`Open Token Comparison`}
            aria-label={`Open Token Comparison`}
            className="link"
            onClick={onOpenDetail}
          >
            <ChartNoAxesCombined size={40} style={{ color: 'var(--accent-up)' }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#e5e7eb', // Changed to light color for visibility
                marginTop: 2,
                letterSpacing: 0.5,
                textShadow: '0 1px 2px rgba(0,0,0,0.25)', // Optional for extra contrast
              }}
            >
              Compare
            </span>
          </button>
        </h1>
        <h2 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {(
            [
              ['scanner-pairs', 'Scanner'],
              ['tick', 'Tick'],
              ['pair-stats', 'Pair Stats'],
              ['wpeg-prices', 'WPEG'],
            ] as const
          ).map(([key, label]) => {
            return (
              <button
                type="button"
                key={key}
                className="muted"
                title={`Inject a faux ${label} event`}
                onClick={() => {
                  onInject(key)
                }}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  border: '1px solid #4b5563',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                  letterSpacing: 0.5,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {label}: <strong style={{ marginLeft: 4 }}>{eventCounts[key]}</strong>
              </button>
            )
          })}
        </h2>
        <h2 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
            VisSubs: <strong style={{ marginLeft: 4 }}>{subCount}</strong>
          </span>
          <span
            className="muted"
            title="InvisSubs = active invisible subscriptions (queue length). Rotates within a quota computed from the Throttle base + 10% of the remainder; not the total invisible rows."
            style={{
              fontSize: 11,
              padding: '2px 6px',
              border: '1px solid #4b5563',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              letterSpacing: 0.5,
            }}
          >
            InvisSubs: <strong style={{ marginLeft: 4 }}>{invisCount}</strong>
          </span>
        </h2>
        {!showOverlay && (
          <Toast>
            This demo site can mix <strong>mock/fake data</strong> with real-time data from the{' '}
            <a href="https://www.dexcelerate.com/" target="_blank" rel="noopener noreferrer">
              DEX Scanner API
            </a>
          </Toast>
        )}
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
            title="Default base for invisible subs when Throttle is unset"
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
              step={25}
              value={subBaseLimit}
              onChange={(e) => {
                const n = Math.max(0, Math.min(1000, Number(e.currentTarget.value) || 0))
                setSubBaseLimit(n)
                setDefaultInvisibleBaseLimit(n)
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
          <button
            type="button"
            className="btn"
            aria-pressed={isAutoPlaying}
            onClick={onToggleAutoPlay}
            title={isAutoPlaying ? 'Stop auto Tick' : 'Start auto Tick'}
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
            AutoTick: {isAutoPlaying ? 'On' : 'Off'}
          </button>
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
    tokenQuery?: string
    includeStale?: boolean
    includeDegraded?: boolean
  }
}

// Local action types matching tokens.reducer.js
interface ScannerPairsAction {
  type: 'scanner/pairs'
  payload: { page: number; scannerPairs: unknown[] }
}
interface ScannerWsAction {
  type: 'scanner/ws'
  payload: { page: number; scannerPairs: unknown[] }
}
interface ScannerPairsTokensAction {
  type: 'scanner/pairsTokens'
  payload: { page: number; tokens: TokenRow[] }
}
interface ScannerAppendTokensAction {
  type: 'scanner/appendTokens'
  payload: { page: number; tokens: TokenRow[] }
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
    tokenQuery?: string
    includeStale?: boolean
    includeDegraded?: boolean
  }
}

type Action =
  | ScannerPairsAction
  | ScannerWsAction
  | ScannerPairsTokensAction
  | ScannerAppendTokensAction
  | ScannerAppendAction
  | TickAction
  | PairStatsAction
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
  // Typed alias for the JS helper that sends both pair + pair-stats subscribe messages
  const wsSendSubscribeSafe = wsSendSubscribe as unknown as (p: {
    pair: string
    token: string
    chain: string
  }) => void
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
  // Dev helper: only expose the fixture injector in development builds. Ensure no leakage to prod.
  try {
    if (import.meta.env.DEV) {
      ;(
        window as unknown as { __INJECT_WS_FIXTURE__?: (msg: unknown) => void }
      ).__INJECT_WS_FIXTURE__ = (parsed: unknown) => {
        try {
          if (!parsed || typeof parsed !== 'object') return
          // Mirror the onmessage pipeline: bump counters, emit per-key updates, then dispatch mapped action
          const event = (parsed as any).event
          try {
            if (event === 'tick' || event === 'pair-stats') bumpEventCount(event)
          } catch {}
          try {
            if (event === 'tick') {
              const d = (parsed as any).data || {}
              const pairObj = d.pair || {}
              const token1 = pairObj.token1Address || pairObj.token
              const chainVal = pairObj.chain
              if (
                typeof token1 === 'string' &&
                (typeof chainVal === 'string' || typeof chainVal === 'number')
              ) {
                const key = buildTickKey(token1.toLowerCase(), chainVal)
                emitUpdate({ key, type: 'tick', data: d })
              }
            } else if (event === 'pair-stats') {
              const d = (parsed as any).data || {}
              const pairObj = d.pair || {}
              const token1 = pairObj.token1Address
              const chainVal = pairObj.chain
              if (
                typeof token1 === 'string' &&
                (typeof chainVal === 'string' || typeof chainVal === 'number')
              ) {
                const key = buildTickKey(token1.toLowerCase(), chainVal)
                emitUpdate({ key, type: 'pair-stats', data: d })
              }
            }
          } catch {}
          const action = mapIncomingMessageToActionSafe(parsed)
          if (action) d(action as Action)
        } catch (err) {
          try {
            console.error('[__INJECT_WS_FIXTURE__] failed', err)
          } catch {}
        }
      }
    } else {
      // Ensure the hook is not present in non-DEV environments
      try {
        const anyWin = window as unknown as { __INJECT_WS_FIXTURE__?: unknown }
        if (anyWin && '__INJECT_WS_FIXTURE__' in anyWin) {
          try {
            // delete the dev helper if present to avoid leakage to production
            delete (anyWin as any).__INJECT_WS_FIXTURE__
          } catch {
            try {
              anyWin.__INJECT_WS_FIXTURE__ = undefined
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}

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
        // Attach lightweight listeners that mirror the essential onmessage pipeline for this mount.
        // We avoid reusing previous mount's closures by adding new listeners scoped to this component
        // and remove them in cleanup. This prevents the spinner from getting stuck when the WS
        // object survives a hot reload or page-level reuse.
        // reuse existing WebSocket instance
        const onMessage = (ev: MessageEvent) => {
          try {
            let parsed: Record<string, unknown> | null = null
            try {
              parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
            } catch {
              return
            }
            const event = typeof parsed?.event === 'string' ? parsed.event : undefined
            // Bump and emit minimal per-key updates to keep UI reactive
            try {
              if (event === 'tick' || event === 'pair-stats') bumpEventCount(event)
            } catch {}
            try {
              if (event === 'tick') {
                const d = (parsed as any).data || {}
                const pairObj = d.pair || {}
                const token1 = pairObj.token1Address || pairObj.token
                const chainVal = pairObj.chain
                if (
                  typeof token1 === 'string' &&
                  (typeof chainVal === 'string' || typeof chainVal === 'number')
                ) {
                  const key = buildTickKey(token1.toLowerCase(), chainVal)
                  emitUpdate({ key, type: 'tick', data: d })
                }
              } else if (event === 'pair-stats') {
                const d = (parsed as any).data || {}
                const pairObj = d.pair || {}
                const token1 = pairObj.token1Address
                const chainVal = pairObj.chain
                if (
                  typeof token1 === 'string' &&
                  (typeof chainVal === 'string' || typeof chainVal === 'number')
                ) {
                  const key = buildTickKey(token1.toLowerCase(), chainVal)
                  emitUpdate({ key, type: 'pair-stats', data: d })
                }
              }
            } catch {}
            // Map and dispatch
            try {
              const action = mapIncomingMessageToActionSafe(parsed)
              if (action) {
                startTransition(() => {
                  d(action as Action)
                })
              }
            } catch (err) {
              if (isDebugEnabled()) {
                try {
                  console.error('WS(reuse) handler error', err)
                } catch {}
              }
            }
          } catch {
            /* no-op */
          }
        }
        const onErr = (ev: Event) => {
          try {
            console.log('WS(reuse): error', ev)
          } catch {}
        }
        const onClose = (ev: CloseEvent) => {
          try {
            console.log('WS(reuse): close', ev?.code)
          } catch {}
        }
        try {
          existing.addEventListener('message', onMessage)
          existing.addEventListener('error', onErr)
          existing.addEventListener('close', onClose)
        } catch {
          /* ignore attach errors */
        }
        // If already open, immediately send scanner subscriptions for this mount to ensure we receive pairs
        let reuseFailTimer: ReturnType<typeof setTimeout> | null = null
        try {
          const sendSubs = () => {
            try {
              existing.send(
                JSON.stringify(
                  buildScannerSubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }),
                ),
              )
            } catch {}
            try {
              existing.send(
                JSON.stringify(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE })),
              )
            } catch {}
          }
          if (existing.readyState === WebSocket.OPEN) {
            sendSubs()
          } else {
            // If still connecting, once it opens send subscriptions once
            const onceOpen = () => {
              try {
                sendSubs()
              } catch {}
              try {
                existing.removeEventListener('open', onceOpen)
              } catch {}
            }
            try {
              existing.addEventListener('open', onceOpen)
            } catch {}
          }
          // Short reuse failsafe: if no pages/rows arrive within a few seconds, release overlay to avoid stuck UX
          try {
            reuseFailTimer = setTimeout(() => {
              try {
                const pagesNow = (state as any).pages ?? {}
                const hasAnyPageNow = Object.keys(pagesNow).length > 0
                const byIdNow = (state as any).byId ?? {}
                const hasAnyRowsNow = !!(byIdNow && Object.keys(byIdNow).length > 0)
                if (
                  !hasAnyPageNow &&
                  !hasAnyRowsNow &&
                  !wsScannerReady.trending &&
                  !wsScannerReady.newer
                ) {
                  try {
                    console.warn(
                      'App: reuse branch failsafe — no scanner-pairs after reuse, releasing overlay',
                    )
                  } catch {}
                  setAppReady(true)
                }
              } catch {
                setAppReady(true)
              }
            }, 3000)
          } catch {}
        } catch {}

        return () => {
          try {
            existing.removeEventListener('message', onMessage)
          } catch {}
          try {
            existing.removeEventListener('error', onErr)
          } catch {}
          try {
            existing.removeEventListener('close', onClose)
          } catch {}
          try {
            if (reuseFailTimer) clearTimeout(reuseFailTimer)
          } catch {}
        }
      }
    } catch {
      /* no-op */
    }

    // Prefer local dev WS path in development so Vite's proxy (vite.config.ts) can forward
    // WebSocket traffic to the local backend. Allow override via VITE_WS_URL for testing/mocks.
    const prodUrl = 'wss://api-rs.dexcelerate.com/ws'
    const envUrl: string | null =
      typeof import.meta.env.VITE_WS_URL === 'string' ? import.meta.env.VITE_WS_URL : null
    const devLocal = import.meta.env.DEV ? '/ws' : null
    const urls: string[] = [devLocal, envUrl, prodUrl].filter(Boolean) as string[]

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
              // Disable runtime throttle; single UI selector controls base limit only
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
            console.log(
              `[${new Date().toISOString()}] scanner-filter sent (Trending) page ${TRENDING_PAGE}`,
            )
            ws.send(JSON.stringify(buildScannerSubscriptionSafe({ ...newFilters, page: NEW_PAGE })))
            console.log(`[${new Date().toISOString()}] scanner-filter sent (New) page ${NEW_PAGE}`)
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
                  if (typeof (ev as unknown) === 'string') return ev as unknown as string
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
            // Defer all heavy work to avoid blocking the main thread
            const defer = (cb: () => void) => {
              if (window.requestIdleCallback) {
                window.requestIdleCallback(cb, { timeout: 100 })
              } else {
                setTimeout(cb, 0)
              }
            }
            const start = performance.now()
            defer(() => {
              const parseStart = performance.now()
              let parsed: Record<string, unknown> | null = null
              try {
                parsed = JSON.parse(
                  typeof ev.data === 'string' ? ev.data : String(ev.data),
                ) as Record<string, unknown>
              } catch (err) {
                console.error('WS: failed to parse message', err)
                return
              }
              const parseEnd = performance.now()
              const event = typeof parsed?.event === 'string' ? parsed.event : undefined
              const data =
                typeof parsed?.data === 'object' && parsed?.data !== null ? parsed.data : undefined
              // Validation
              const validationStart = performance.now()
              try {
                // Debug: Log tick events specifically to help diagnose the issue
                if (event === 'tick') {
                  console.log('[DEBUG] Tick event received:', parsed)
                }
              } catch {}
              if (event === 'scanner-pairs') {
                let hasPairs = false
                if (data && typeof data === 'object') {
                  const res = (data as { results?: unknown }).results
                  if (res && typeof res === 'object') {
                    const arr = (res as { pairs?: unknown }).pairs
                    if (Array.isArray(arr)) hasPairs = true
                  } else {
                    const pairs = (data as { pairs?: unknown }).pairs
                    if (Array.isArray(pairs)) hasPairs = true
                  }
                }
                if (!hasPairs) {
                  console.error('WS: invalid scanner-pairs payload: missing pairs array', parsed)
                  return
                }
              } else if (event === 'tick') {
                let ok = false
                if (data && typeof data === 'object') {
                  const pairObj = (data as { pair?: unknown }).pair
                  const swaps = (data as { swaps?: unknown }).swaps
                  ok = !!(pairObj && typeof pairObj === 'object' && Array.isArray(swaps))
                }
                if (!ok) {
                  console.error('WS: invalid tick payload: expected { pair, swaps[] }', parsed)
                  return
                }
                // Only increment counter for valid tick events
                try {
                  bumpEventCount(event)
                } catch {}
              } else if (event === 'pair-stats') {
                let ok = false
                if (data && typeof data === 'object') {
                  const pairObj = (data as { pair?: unknown }).pair
                  const addr =
                    pairObj && typeof pairObj === 'object'
                      ? (pairObj as { pairAddress?: unknown }).pairAddress
                      : undefined
                  ok = typeof addr === 'string'
                }
                if (!ok) {
                  console.error('WS: invalid pair-stats payload: expected pair.pairAddress', parsed)
                  return
                }
                // Only increment counter for valid pair-stats events
                try {
                  bumpEventCount(event)
                } catch {}
              }
              const validationEnd = performance.now()
              // WsConsole: log allowed incoming events with brief summaries
              try {
                if (event === 'scanner-pairs') {
                  let count = 0
                  const d = data
                  if (d && typeof d === 'object') {
                    const res = (d as { results?: unknown }).results
                    if (res && typeof res === 'object') {
                      const arr = (res as { pairs?: unknown }).pairs
                      if (Array.isArray(arr)) count = arr.length
                    } else {
                      const pairs = (d as { pairs?: unknown }).pairs
                      if (Array.isArray(pairs)) count = pairs.length
                    }
                  }
                  logWsInfo(`[in] scanner-pairs (${count})`)
                } else if (event === 'tick') {
                  let swapsLen = 0
                  let chainStr = ''
                  const d = data
                  if (d && typeof d === 'object') {
                    const swaps = (d as { swaps?: unknown }).swaps
                    if (Array.isArray(swaps)) swapsLen = swaps.length
                    const pairObj = (d as { pair?: unknown }).pair
                    if (pairObj && typeof pairObj === 'object') {
                      const ch = (pairObj as { chain?: unknown }).chain
                      chainStr = typeof ch === 'string' || typeof ch === 'number' ? String(ch) : ''
                    }
                  }
                  logWsInfo(`[in] tick swaps=${swapsLen} chain=${chainStr}`)
                } else if (event === 'pair-stats') {
                  let chainStr = ''
                  const d = data
                  if (d && typeof d === 'object') {
                    const pairObj = (d as { pair?: unknown }).pair
                    if (pairObj && typeof pairObj === 'object') {
                      const ch = (pairObj as { chain?: unknown }).chain
                      chainStr = typeof ch === 'string' || typeof ch === 'number' ? String(ch) : ''
                    }
                  }
                  logWsInfo(`[in] pair-stats chain=${chainStr}`)
                } else if (event === 'wpeg-prices') {
                  let n = 0
                  const d = data
                  if (d && typeof d === 'object') {
                    const prices = (d as { prices?: unknown }).prices
                    if (prices && typeof prices === 'object') n = Object.keys(prices).length
                  }
                  logWsInfo(`[in] wpeg-prices (${n})`)
                }
              } catch {}
              // Emit update bus events for components listening to per-key activity (UpdateRate, Row animations)
              try {
                if (event === 'tick') {
                  const d = data
                  if (d && typeof d === 'object') {
                    const pairObj = (d as { pair?: unknown }).pair
                    if (pairObj && typeof pairObj === 'object') {
                      const token1 = (pairObj as { token1Address?: unknown }).token1Address
                      const tokenAlt = (pairObj as { token?: unknown }).token
                      const chainUnknown = (pairObj as { chain?: unknown }).chain
                      const tokenStr =
                        typeof token1 === 'string'
                          ? token1
                          : typeof tokenAlt === 'string'
                            ? tokenAlt
                            : undefined
                      const chainVal =
                        typeof chainUnknown === 'string' || typeof chainUnknown === 'number'
                          ? chainUnknown
                          : undefined
                      if (!tokenStr || chainVal === undefined) {
                        // Hard error: we expect token1Address or token and a chain for tick events
                        try {
                          console.error(
                            '[WS tick] Missing token1Address/token or chain in pair object',
                            {
                              pairObj,
                            },
                          )
                        } catch {}
                        // Don't throw here (was previously caught locally); log and abandon handling
                        return
                      }
                      // Normalize token to lowercase for consistent keying across the app
                      const tokenKey = tokenStr.toLowerCase()
                      const key = buildTickKey(tokenKey, chainVal)
                      emitUpdate({ key, type: 'tick', data })
                    }
                  }
                } else if (event === 'pair-stats') {
                  const d = data
                  if (d && typeof d === 'object') {
                    const pairObj = (d as { pair?: unknown }).pair
                    if (pairObj && typeof pairObj === 'object') {
                      const token1 = (pairObj as { token1Address?: unknown }).token1Address
                      const chainUnknown = (pairObj as { chain?: unknown }).chain
                      const tokenStr = typeof token1 === 'string' ? token1 : undefined
                      const chainVal =
                        typeof chainUnknown === 'string' || typeof chainUnknown === 'number'
                          ? chainUnknown
                          : undefined
                      if (tokenStr && chainVal !== undefined) {
                        const tokenKey = tokenStr.toLowerCase()
                        const key = buildTickKey(tokenKey, chainVal)
                        emitUpdate({ key, type: 'pair-stats', data })
                      }
                    }
                  }
                }
              } catch {
                /* no-op */
              }
              // Mapping
              const mapStart = performance.now()
              const action = mapIncomingMessageToActionSafe(parsed)
              const mapEnd = performance.now()
              // If this is a scanner-pairs event, mark the corresponding wsScannerReady flag
              try {
                if (event === 'scanner-pairs') {
                  // Extract page from possible shapes: data.filter.page or data.page
                  let page = 1
                  try {
                    if (
                      parsed &&
                      typeof parsed === 'object' &&
                      parsed.data &&
                      typeof parsed.data === 'object'
                    ) {
                      const d = parsed.data as any
                      if (d.filter && typeof d.filter === 'object' && d.filter.page)
                        page = Number(d.filter.page) || 1
                      else if (d.page) page = Number(d.page) || 1
                    }
                  } catch {}
                  try {
                    // Only update flags if they actually change to avoid render loops
                    setWsScannerReady((prev) => {
                      const nextTrending = prev.trending || page === TRENDING_PAGE
                      const nextNewer = prev.newer || page === NEW_PAGE
                      if (nextTrending === prev.trending && nextNewer === prev.newer) return prev
                      return { trending: nextTrending, newer: nextNewer }
                    })
                    console.info('App: ws scanner-pairs received, marked wsScannerReady', {
                      page,
                      TRENDING_PAGE,
                      NEW_PAGE,
                    })
                  } catch {}
                }
              } catch {}
              if (!action) {
                console.error('WS: unhandled or malformed message', parsed)
                return
              }
              // Dispatch
              const dispatchStart = performance.now()
              startTransition(() => {
                d(action)
              })
              const dispatchEnd = performance.now()
              // Timing logs
              if (import.meta.env.DEV) {
                debugLog(
                  '[WS timing] total:',
                  (dispatchEnd - start).toFixed(2),
                  'ms',
                  'parse:',
                  (parseEnd - parseStart).toFixed(2),
                  'validation:',
                  (validationEnd - validationStart).toFixed(2),
                  'map:',
                  (mapEnd - mapStart).toFixed(2),
                  'dispatch:',
                  (dispatchEnd - dispatchStart).toFixed(2),
                )
              }
            })
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
        if (
          !UNSUBSCRIPTIONS_DISABLED &&
          !import.meta.env.DEV &&
          currentWs &&
          currentWs.readyState === WebSocket.OPEN
        ) {
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
    wsSendSubscribeSafe,
    computePairPayloadsSafe,
    buildScannerUnsubscriptionSafe,
  ])

  const CHAINS = useMemo(() => ['ETH', 'SOL', 'BASE', 'BSC'] as const, [])
  const [trendingCounts, _setTrendingCounts] = useState<Record<string, number>>({})
  const [newCounts, _setNewCounts] = useState<Record<string, number>>({})
  const totalCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of CHAINS) {
      out[c] = (trendingCounts[c] ?? 0) + (newCounts[c] ?? 0)
    }
    return out
  }, [trendingCounts, newCounts, CHAINS])

  // Live update rate tracker: 2s resolution over a 1-minute window (30 samples)
  const blurVersionRef = useRef<number | null>(null)
  const pendingApplyAfterBlurRef = useRef(false)
  // WS event counters (allowed incoming events)
  type WsEventName = 'scanner-pairs' | 'tick' | 'pair-stats' | 'wpeg-prices'
  type WsCounts = Record<WsEventName, number>
  const zeroCounts: WsCounts = { 'scanner-pairs': 0, tick: 0, 'pair-stats': 0, 'wpeg-prices': 0 }
  const countsRef = useRef<WsCounts>({ ...zeroCounts })
  const [eventCounts, setEventCounts] = useState<WsCounts>({ ...zeroCounts })
  const flushTimerRef = useRef<number | null>(null)
  // Strict event counter: only count known, exact event names
  const bumpEventCount = (ev: unknown) => {
    const k =
      ev === 'scanner-pairs' || ev === 'tick' || ev === 'pair-stats' || ev === 'wpeg-prices'
        ? (ev as WsEventName)
        : null
    if (!k) return
    try {
      debugLog('[App] bumpEventCount called for', k)
    } catch {}
    countsRef.current[k] = (countsRef.current[k] ?? 0) + 1
    // Coalesce flushes to avoid excessive setState under high throughput
    flushTimerRef.current ??= window.setTimeout(() => {
      try {
        debugLog('[App] flushing eventCounts', countsRef.current)
        setEventCounts({ ...countsRef.current })
      } finally {
        flushTimerRef.current = null
      }
    }, 250)
  }

  // Live test: inject a faux WS event into the earliest pipeline (parsed message)
  const injectFauxWsEvent = (ev: WsEventName) => {
    // Helper: random from array
    const pick = <T,>(arr: T[]): T | null =>
      arr.length ? arr[Math.floor(Math.random() * arr.length)] : null

    // Per-token events require a visible key
    const visKeys = SubscriptionQueue.getVisibleKeys()
    const randKey = pick(visKeys)
    const parseKey = (key: string | null) => {
      if (!key) return null
      const parts = key.split('|')
      if (parts.length !== 3) return null
      const [pair, token, chain] = parts
      return { pair, token, chain }
    }

    let parsed: Record<string, unknown> | null = null
    const nowIso = new Date().toISOString()

    if (ev === 'tick') {
      const ptc = parseKey(randKey)
      if (!ptc) return
      const price = 1 + Math.random() * 0.5
      parsed = {
        event: 'tick',
        data: {
          pair: { pair: ptc.pair, token: ptc.token, chain: ptc.chain },
          swaps: [
            {
              tokenInAddress: ptc.token,
              tokenOutAddress: ptc.token,
              amountToken1: Math.random() * 100,
              priceToken1Usd: price,
              isOutlier: false,
              ts: Date.now(),
            },
          ],
        },
      }
    } else if (ev === 'pair-stats') {
      const ptc = parseKey(randKey)
      if (!ptc) return
      const price = (1 + Math.random() * 0.5).toFixed(8)
      parsed = {
        event: 'pair-stats',
        data: {
          pair: { pairAddress: ptc.pair, token1Address: ptc.token, chain: ptc.chain },
          // Provide pairStats windows similar to real server events so reducer/Row can pick up prices
          pairStats: {
            twentyFourHour: { last: price, first: null, change: null, diff: null },
            oneHour: { last: price, first: null, change: null, diff: null },
            fiveMin: { last: price, first: null, change: null, diff: null },
          },
          // Backwards-compatible migration progress field expected by reducer
          migrationProgress: String(Math.floor(Math.random() * 100)),
          audit: { isHoneypot: false, isMintable: false, isFreezable: false },
          liquidity: { usd: Math.floor(Math.random() * 1_000_000) },
          updatedAt: nowIso,
        },
      }
    } else if (ev === 'scanner-pairs') {
      // Build a tiny WS-like scanner payload with 2 items
      const baseChain = pick(['ETH', 'BSC', 'BASE', 'SOL'])! || 'ETH'
      const mk = (i: number) => ({
        id: `${baseChain}-FAUX-${Date.now()}-${i}`,
        tokenName: `Faux ${i}`,
        tokenSymbol: `FX${i}`,
        tokenAddress: `0x${(Math.random() * 1e16).toString(16).slice(0, 16).padEnd(16, '0')}`,
        pairAddress: `0x${(Math.random() * 1e16).toString(16).slice(0, 16).padEnd(16, '0')}`,
        chain: baseChain,
        exchange: 'DEX',
        priceUsd: Math.random() * 2,
        volumeUsd: Math.random() * 10_000,
        mcap: Math.random() * 1_000_000,
        priceChangePcs: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
        transactions: { buys: 0, sells: 0 },
        liquidity: { current: Math.random() * 100_000, changePc: 0 },
        tokenCreatedTimestamp: nowIso,
      })
      parsed = {
        event: 'scanner-pairs',
        data: {
          filter: { page: TRENDING_PAGE },
          results: { pairs: [mk(1), mk(2)] },
        },
      }
    } else if (ev === 'wpeg-prices') {
      parsed = {
        event: 'wpeg-prices',
        data: { prices: { ETH: 1, BSC: 1, BASE: 1, SOL: 1 } },
      }
    }

    if (!parsed) return

    // Bump counters immediately (same behavior as real onmessage)
    bumpEventCount(parsed.event)

    // Emit update bus events for per-token types for UI gizmos
    try {
      if (parsed.event === 'tick') {
        const d = parsed.data as Record<string, unknown>
        const pairObj = d?.pair as Record<string, unknown>
        const token1 = (pairObj?.token1Address as string) || (pairObj?.token as string)
        const chainVal = pairObj?.chain as string | number | undefined
        if (token1 && chainVal !== undefined) {
          const key = buildTickKey(token1.toLowerCase(), chainVal)
          emitUpdate({ key, type: 'tick', data: parsed.data })
        }
      } else if (parsed.event === 'pair-stats') {
        const d = parsed.data as Record<string, unknown>
        const pairObj = d?.pair as Record<string, unknown>
        const token1 = pairObj?.token1Address as string | undefined
        const chainVal = pairObj?.chain as string | number | undefined
        if (token1 && chainVal !== undefined) {
          const key = buildTickKey(token1.toLowerCase(), chainVal)
          emitUpdate({ key, type: 'pair-stats', data: parsed.data })
        }
      }
    } catch {
      /* no-op */
    }

    // Map and dispatch via the same pathway as real messages
    const action = mapIncomingMessageToActionSafe(parsed)
    if (action) {
      d(action as Action)
    }
  }
  // Live subscriptions count (polled)
  const [subCount, setSubCount] = useState<number>(0)
  // Invisible subs count (polled)
  const [invisCount, setInvisCount] = useState<number>(0)
  // Global throttle for total subscriptions (visible + inactive)
  // Dynamic base limit used when no throttle is applied (affects default heuristic)
  const [subBaseLimit, setSubBaseLimit] = useState<number>(100)
  useEffect(() => {
    try {
      const safe = Math.max(0, Math.min(1000, subBaseLimit || 0))
      setDefaultInvisibleBaseLimit(safe)
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
        setSubCount(SubscriptionQueue.getVisibleCount())
        setInvisCount(SubscriptionQueue.getInvisCount())
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
  // Log when VisSubs changes from the UI polling perspective to correlate with SubscriptionQueue logs
  useEffect(() => {
    try {
      const any = SubscriptionQueue as unknown as { __debug__?: { getVisible?: () => string[] } }
      const vis = any.__debug__?.getVisible ? any.__debug__?.getVisible() : []
      console.log('[App] VisSubs changed', {
        next: subCount,
        invis: invisCount,
        sample: (vis || []).slice(0, 10),
        time: new Date().toISOString(),
      })
    } catch {}
  }, [subCount, invisCount])
  const [rateSeries] = useState<number[]>([])
  // WebSocket console visibility (default hidden)
  const [consoleVisible, setConsoleVisible] = useState(false)

  // Auto-play faux tick events (Play/Pause). Minimal: emit a tick every 1s when enabled.
  const [autoPlaying, setAutoPlaying] = useState(false)
  useEffect(() => {
    if (!autoPlaying) return
    const id = window.setInterval(() => {
      try {
        injectFauxWsEvent('tick')
      } catch {
        /* no-op */
      }
    }, 1000)
    return () => {
      try {
        window.clearInterval(id)
      } catch {}
    }
    // only depends on autoPlaying and injectFauxWsEvent reference
  }, [autoPlaying])

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
  // Loading overlay visibility with smooth fade-out when clearing
  const [showOverlay, setShowOverlay] = useState<boolean>(true)
  const [overlayClosing, setOverlayClosing] = useState<boolean>(false)
  // Overlay DOM ref + paint ACK. Some environments mount/pause the overlay such that the
  // main readiness computation can race ahead and miss the overlay's mounted lifecycle.
  // `overlayAck` becomes true once the overlay DIV has painted. While the overlay is
  // visible and not acked we run a boot-probe that re-emits the loaded-state readiness
  // once-per-second so the overlay will see the readiness transition reliably.
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [overlayAck, setOverlayAck] = useState(false)
  useEffect(() => {
    if (!showOverlay) {
      setOverlayAck(false)
      return
    }
    // When the overlay becomes visible, clear ack and mark it after next paint
    setOverlayAck(false)
    let mounted = true
    // Use requestAnimationFrame to detect paint; fall back to setTimeout
    const onPaint = () => {
      if (!mounted) return
      try {
        setOverlayAck(true)
      } catch {}
    }
    try {
      if (window.requestAnimationFrame) window.requestAnimationFrame(onPaint)
      else setTimeout(onPaint, 16)
    } catch {
      try {
        setTimeout(onPaint, 16)
      } catch {}
    }
    return () => {
      mounted = false
    }
  }, [showOverlay])
  // Boot-probe: while overlay is visible but has not acked paint, re-emit readiness
  useEffect(() => {
    if (!showOverlay || overlayAck) return
    let id: number | null = null
    const probe = () => {
      try {
        const pages =
          (state as unknown as { pages?: Partial<Record<number, string[]>> }).pages ?? {}
        const trendingArr = (pages as Record<number, string[] | undefined>)[TRENDING_PAGE]
        const newArr = (pages as Record<number, string[] | undefined>)[NEW_PAGE]
        const hasTrending = Array.isArray(trendingArr)
        const hasNew = Array.isArray(newArr)
        const byId = (state as unknown as { byId?: Record<string, unknown> }).byId ?? {}
        const hasAnyRows = byId && Object.keys(byId).length > 0
        // Re-emit readiness signals so the overlay receives them even if timing races occur.
        setWsScannerReady((prev) => {
          const next = {
            trending: prev.trending || hasTrending,
            newer: prev.newer || hasNew,
          }
          return next.trending === prev.trending && next.newer === prev.newer ? prev : next
        })
        // If we already have any rows/pages, also nudge appReady so the UI can progress.
        if (!appReady && (hasTrending || hasNew || hasAnyRows)) {
          setAppReady(true)
        }
      } catch {}
    }
    // Fire immediately, then every 1s until overlay ack
    try {
      probe()
      id = window.setInterval(probe, 1000)
    } catch {
      /* no-op */
    }
    return () => {
      try {
        if (id != null) window.clearInterval(id)
      } catch {}
    }
    // Intentionally skip state in deps to avoid resetting probe too aggressively; we only
    // need to probe until overlay acknowledges paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlay, overlayAck, appReady])
  // Synchronize overlay with appReady state; when ready, fade for 2s before unmounting
  useEffect(() => {
    if (!appReady) {
      setShowOverlay(true)
      setOverlayClosing(false)
      return
    }
    setOverlayClosing(true)
    const t = window.setTimeout(() => {
      setShowOverlay(false)
    }, 2000)
    return () => {
      try {
        window.clearTimeout(t)
      } catch {}
    }
  }, [appReady])
  // Early boot diagnostics — log current theme and page keys when state/theme changes
  useEffect(() => {
    try {
      console.info('App: mount', {
        theme,
        bypassBoot: false,
      })
    } catch {
      /* no-op */
    }
  }, [theme])
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
    if (appReady) return // Only run if spinner is still showing
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
        setWsScannerReady((prev) => {
          const next = {
            trending: prev.trending || hasTrending,
            newer: prev.newer || hasNew,
          }
          return next.trending === prev.trending && next.newer === prev.newer ? prev : next
        })
        // Diagnostic: report wsScannerReady after update (will show previous state here)
        try {
          console.info('App: requested wsScannerReady update', { hasTrending, hasNew })
        } catch {}
        try {
          // If REST already provided pages or rows, mark app ready to avoid the boot overlay
          const byId = (state as unknown as { byId?: Record<string, unknown> }).byId ?? {}
          const hasAnyRows = byId && Object.keys(byId).length > 0
          if (!appReady && (hasTrending || hasNew || hasAnyRows)) {
            try {
              console.info('App: pages-scan -> marking appReady (REST present)', {
                hasTrending,
                hasNew,
                hasAnyRows,
              })
            } catch {}
            setAppReady(true)
          }
        } catch {}
      }
    } catch {}
  }, [appReady, state])
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

  // Stable WebSocket send helper
  const wsSend = useCallback(
    (obj: unknown) => {
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
    },
    [isAllowedOutgoingEventSafe],
  )

  // Keep a ref to latest byId for a stable getRowById callback
  const byIdRef = useRef<Record<string, TokenRow | undefined>>({})
  useEffect(() => {
    try {
      byIdRef.current =
        (state as unknown as { byId?: Record<string, TokenRow | undefined> }).byId ?? {}
    } catch {
      byIdRef.current = {}
    }
  }, [state])

  // Stable row resolver for downstream consumers (reads from byIdRef)
  const getRowById = useCallback((id: string): TokenRow | undefined => {
    try {
      const byId = byIdRef.current
      return byId[id] ?? byId[id?.toLowerCase?.() ?? id]
    } catch {
      return undefined
    }
  }, [])

  const openDetails = useCallback(
    (row: TokenRow) => {
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
          const chain = row.chain
          engageSubscriptionLock(buildPairKey(pair, token, chain))
        } else {
          engageSubscriptionLock()
        }
      } catch {
        /* no-op */
      }
      // Cancel scanner streams for both tables while modal is focused, then subscribe to the selected token
      try {
        if (!UNSUBSCRIPTIONS_DISABLED) {
          wsSend(buildScannerUnsubscriptionSafe({ ...trendingFilters, page: TRENDING_PAGE }))
          wsSend(buildScannerUnsubscriptionSafe({ ...newFilters, page: NEW_PAGE }))
        }
      } catch {
        /* no-op */
      }
      const pair = row.pairAddress ?? ''
      const token = row.tokenAddress ?? ''
      if (pair && token) {
        const chain = row.chain
        wsSendSubscribeSafe({ pair, token, chain })
      }
    },
    [trendingFilters, newFilters, wsSend, wsSendSubscribeSafe],
  )

  const closeDetails = useCallback(() => {
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
  }, [trendingFilters, newFilters, wsSend, buildScannerSubscriptionSafe])

  // Fetch initial token data from REST API and dispatch to reducer
  useEffect(() => {
    console.log('[App.tsx] Initial fetch effect running')
    // Use sessionStorage to prevent duplicate fetches across remounts
    const isDev = import.meta.env.DEV
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (window.sessionStorage.getItem('DEX_SCANNER_INITIAL_FETCHED')) {
        console.log('[App.tsx] Initial fetch guard: already set, skipping fetch')
        if (!isDev) return
        // In dev, ignore the guard and always fetch
        console.log('[App.tsx] DEV mode: ignoring sessionStorage guard')
      } else {
        console.log('[App.tsx] Initial fetch guard: setting now')
        window.sessionStorage.setItem('DEX_SCANNER_INITIAL_FETCHED', '1')
      }
    } else {
      console.log('[App.tsx] sessionStorage not available, cannot set guard')
    }
    let cancelled = false
    async function fetchInitialData() {
      try {
        console.log('[App.tsx] fetchScanner: Trending Tokens (effect)')
        const trendingRes = await fetchScanner({
          ...TRENDING_TOKENS_FILTERS,
          page: 1,
          __source: 'App.tsx useEffect Trending',
        })
        console.log('[App.tsx] fetchScanner: Trending Tokens result', trendingRes)
        if (!cancelled) {
          console.log('[App.tsx] dispatching scanner/pairsTokens for Trending', trendingRes.tokens)
          d({
            type: 'scanner/pairsTokens',
            payload: { page: TRENDING_PAGE, tokens: trendingRes.tokens },
          })
        }
      } catch (err) {
        console.error('[App] Initial REST fetch failed: Trending', err)
      }
      try {
        console.log('[App.tsx] fetchScanner: New Tokens (effect)')
        const newRes = await fetchScanner({
          ...NEW_TOKENS_FILTERS,
          page: 1,
          __source: 'App.tsx useEffect New',
        })
        console.log('[App.tsx] fetchScanner: New Tokens result', newRes)
        if (!cancelled) {
          console.log('[App.tsx] dispatching scanner/pairsTokens for New', newRes.tokens)
          d({
            type: 'scanner/pairsTokens',
            payload: { page: NEW_PAGE, tokens: newRes.tokens },
          })
        }
      } catch (err) {
        console.error('[App] Initial REST fetch failed: New', err)
      }
    }
    void fetchInitialData()
    return () => {
      cancelled = true
    }
  }, [d, TRENDING_PAGE, NEW_PAGE])

  return (
    <div style={{ position: 'relative' }}>
      {(() => {
        // Smooth fade-out overlay: keep mounted while closing
        // showOverlay is true while visible or fading; overlayClosing triggers opacity transition
        return showOverlay ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: '#0b0f14',
              color: '#e5e7eb',
              zIndex: 1000,
              opacity: overlayClosing ? 0 : 1,
              transition: 'opacity 2000ms ease',
              pointerEvents: overlayClosing ? 'none' : 'auto',
            }}
            ref={overlayRef}
            aria-hidden={overlayClosing ? 'true' : undefined}
          >
            <div style={{ maxWidth: 420 }}>
              <Toast>
                This demo site can mix <strong>mock/fake data</strong> with real-time data from the{' '}
                <a href="https://www.dexcelerate.com/" target="_blank" rel="noopener noreferrer">
                  DEX Scanner API
                </a>
              </Toast>
              <div
                className="status loading-bump loading-xl"
                role="status"
                aria-live="polite"
                aria-busy={!overlayClosing}
              >
                <span className="loading-spinner" aria-hidden="true" />
                <span className="loading-text">Loading data…</span>
              </div>
            </div>
          </div>
        ) : null
      })()}
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
          title="YACS (Demo)"
          version={(state as unknown as { version?: number }).version ?? 0}
          theme={theme}
          onThemeChange={(v) => {
            setTheme(v)
          }}
          lockActive={lockActive}
          eventCounts={eventCounts}
          subCount={subCount}
          invisCount={invisCount}
          consoleVisible={consoleVisible}
          onToggleConsole={() => {
            setConsoleVisible((v) => !v)
          }}
          onOpenDetail={() => {
            setDetailRow(null)
            setDetailOpen(true)
          }}
          subBaseLimit={subBaseLimit}
          setSubBaseLimit={(n: number) => {
            ;(setSubBaseLimit as (n: number) => void)(n)
          }}
          onInject={injectFauxWsEvent}
          isAutoPlaying={autoPlaying}
          onToggleAutoPlay={() => {
            setAutoPlaying((s) => !s)
          }}
          showOverlay={showOverlay}
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
          {/* Cleanup: Remove log tracing for state and rows */}
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
                ((action: { type?: unknown; payload?: unknown }) => {
                  ;(dispatch as unknown as React.Dispatch<Action>)(action as unknown as Action)
                }) as unknown as React.Dispatch<
                  | ScannerWsAction
                  | ScannerPairsTokensAction
                  | ScannerAppendAction
                  | ScannerAppendTokensAction
                >
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
                  ;(dispatch as unknown as React.Dispatch<Action>)(action as unknown as Action)
                }) as unknown as React.Dispatch<
                  | ScannerWsAction
                  | ScannerPairsTokensAction
                  | ScannerAppendAction
                  | ScannerAppendTokensAction
                >
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
        <ul>
          <li>
            ⚠️ WARNING ⚠️ This site can mix <strong>mock/fake data</strong> with real-time from the{' '}
            <a href="https://www.dexcelerate.com/" target="_blank" rel="noopener noreferrer">
              DEX Scanner API
            </a>
          </li>
          <li>This is a prod demo of what local dev could be like if you hire me!</li>
          <li>
            Copyright (c) 2025 Peter H. Boling -
            <a href="https://discord.gg/3qme4XHNKN">
               Galtzo.com
              <picture>
                <img
                  src="https://logos.galtzo.com/assets/images/galtzo-floss/avatar-128px-blank.svg"
                  alt="Galtzo.com Logo (Wordless) by Aboling0, CC BY-SA 4.0"
                  width="24"
                />
              </picture>
            </a>
            .
          </li>
        </ul>
      </div>
    </div>
  )
}

export default App
