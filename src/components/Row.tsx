import { memo, useEffect, useRef, useState } from 'react'
import NumberCell from './NumberCell'
import AuditIcons from './AuditIcons'
import {
  Globe,
  Eye,
  ChartNoAxesCombined,
  Play,
  Pause,
  ArrowUpFromLine,
  ArrowDownFromLine,
  Link as LinkIcon,
} from 'lucide-react'
import { formatAge, ellipsed } from '../helpers/format'
import type { Token as TokenRow } from '../models/Token'
import { onUpdateKey } from '../updates.bus'
import { buildTickKey } from '../utils/key_builder'
import Sparkline from './Sparkline'
import { SiX, SiTelegram, SiDiscord } from '@icons-pack/react-simple-icons'

export interface RowProps {
  row: TokenRow
  idx: number
  rowsLen: number
  composedId: string
  getRowStatus?: (
    row: TokenRow,
  ) => { state: 'subscribed' | 'unsubscribed' | 'disabled'; tooltip?: string } | undefined
  onOpenRowDetails?: (row: TokenRow) => void
  onToggleRowSubscription?: (row: TokenRow) => void
  registerRow: (el: HTMLTableRowElement | null, row: TokenRow) => void
}

const Row = memo(
  function Row({
    row: t,
    idx,
    rowsLen,
    composedId,
    getRowStatus,
    onOpenRowDetails,
    onToggleRowSubscription,
    registerRow,
  }: RowProps) {
    const rowNum = idx + 1
    // Global 1s tick to force sparkline to advance even without new data
    const [_secTick, setSecTick] = useState(0)
    const eyeRef = useRef<HTMLButtonElement | null>(null)
    const sparkRef = useRef<HTMLDivElement | null>(null)
    const trRef = useRef<HTMLTableRowElement | null>(null)
    // Start as not visible; Table will mark it via dex:row-visibility when in viewport
    const isVisibleRef = useRef<boolean>(false)
    const lastPriceRef = useRef<number>(t.priceUsd)
    // Latest incoming tick override for sparkline's most recent bucket (use state to trigger renders)
    const [latestOverride, setLatestOverride] = useState<{ price: number; at: number } | null>(null)
    // Computed sparkline height based on row line-height and multiplier (default 2x)
    const [sparkHeight, setSparkHeight] = useState<number>(34)
    const [sparkMultiplier, setSparkMultiplier] = useState<number>(2)
    // Measured sparkline container width (viewBox width) so SVG can span full cell width
    const [sparkWidth, setSparkWidth] = useState<number>(120)
    // Temporary stroke color pulse to match the incoming dot color
    const pulseColorRef = useRef<string>('')
    const pulseUntilRef = useRef<number>(0)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
      lastPriceRef.current = t.priceUsd
    }, [t.priceUsd])

    // Measure the row's computed line-height and compute sparkHeight = 2x lineHeight
    useEffect(() => {
      function measure() {
        try {
          const el = trRef.current
          const base = document.documentElement
          const target = el || base
          const cs = window.getComputedStyle(target as Element)
          // Try to read multiplier from CSS variable --sparkline-multiplier (per-row or root)
          const cssMulRaw = cs.getPropertyValue('--sparkline-multiplier') ?? ''
          const cssMul = parseFloat(cssMulRaw ?? '')
          const mult = Number.isFinite(cssMul) && cssMul > 0 ? cssMul : 2
          setSparkMultiplier(mult)

          let lh = parseFloat(cs.lineHeight) || NaN
          if (!Number.isFinite(lh) || lh <= 0) {
            const fs = parseFloat(cs.fontSize) || 16
            lh = Math.round(fs * 1.2)
          }
          // Sparkline should be multiplier * line height (default multiplier=2)
          const desired = Math.max(24, Math.round(lh * mult))
          setSparkHeight(desired)
        } catch {
          // ignore measurement failures and keep default
        }
      }
      measure()
      // Also measure the spark container width; prefer ResizeObserver for accuracy
      const measureSpark = () => {
        try {
          const el = sparkRef.current
          if (el) {
            const w = Math.max(60, Math.floor(el.getBoundingClientRect().width))
            setSparkWidth(w)
          }
        } catch {}
      }

      measureSpark()
      // Use ResizeObserver when available to watch the spark container size
      let ro: ResizeObserver | null = null
      // Access ResizeObserver in a type-safe way (avoid `any`) and only if available
      const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
      // Capture current elements so cleanup can unobserve the exact nodes we observed
      const observedSpark = sparkRef.current
      const observedTr = trRef.current
      if (typeof RO === 'function') {
        try {
          const localRo = new RO(() => {
            measure()
            measureSpark()
          })
          if (observedSpark) localRo.observe(observedSpark)
          if (observedTr) localRo.observe(observedTr)
          ro = localRo
        } catch {
          ro = null
        }
      }
      // Fallback: listen for window resize
      const onW = () => {
        measure()
        measureSpark()
      }
      window.addEventListener('resize', onW)
      return () => {
        window.removeEventListener('resize', onW)
        try {
          if (ro) {
            if (observedSpark) ro.unobserve(observedSpark)
            if (observedTr) ro.unobserve(observedTr)
            ro.disconnect()
          }
        } catch {}
      }
    }, [])

    useEffect(() => {
      const handler = () => {
        setSecTick((n) => n + 1)
      }
      try {
        window.addEventListener('dex:tick', handler as EventListener)
      } catch {}
      return () => {
        try {
          window.removeEventListener('dex:tick', handler as EventListener)
        } catch {}
      }
    }, [])

    // Track row visibility via a custom event emitted by Table’s IntersectionObserver
    useEffect(() => {
      const el = trRef.current
      if (!el) return
      // Seed from current attribute if Table has already computed it
      try {
        isVisibleRef.current = el.getAttribute('data-visible') === '1'
      } catch {}
      const handler = (ev: Event) => {
        try {
          const ce = ev as CustomEvent<{ visible?: boolean }>
          const v = typeof ce.detail?.visible === 'boolean' ? ce.detail.visible : undefined
          if (typeof v === 'boolean') isVisibleRef.current = v
        } catch {
          /* no-op */
        }
      }
      el.addEventListener('dex:row-visibility', handler as EventListener)
      return () => {
        try {
          el.removeEventListener('dex:row-visibility', handler as EventListener)
        } catch {}
      }
    }, [])

    // Subscribe to per-token tick updates and animate a dot from eye to sparkline
    useEffect(() => {
      const token = (t as { tokenAddress?: string }).tokenAddress
      const chain = t.chain
      if (!token || !chain) return
      const key = buildTickKey(token.toLowerCase(), chain)
      return onUpdateKey(key, (e) => {
        // Only respond to per-token events for this row (tick or pair-stats)
        if (e.type !== 'tick' && e.type !== 'pair-stats') return
        // Only animate when the row is visible within the scrollpane viewport
        // Additionally, pause animations while the detail modal is open
        try {
          const modalOpen = document.body.getAttribute('data-detail-open') === '1'
          if (modalOpen) return
        } catch {}
        if (!isVisibleRef.current) return
        // Try to extract a best-effort latest price from event data
        let newPrice: number | null = null
        try {
          if (e.type === 'tick') {
            const dd = e.data as {
              swaps?: { isOutlier?: boolean; priceToken1Usd?: number | string }[]
            }
            if (Array.isArray(dd?.swaps)) {
              const latest = dd.swaps.filter((s) => !s.isOutlier).pop()
              if (latest) {
                const v =
                  typeof latest.priceToken1Usd === 'number'
                    ? latest.priceToken1Usd
                    : parseFloat(latest.priceToken1Usd ?? 'NaN')
                if (Number.isFinite(v)) newPrice = v
              }
            }
          } else if (e.type === 'pair-stats') {
            // pair-stats contains aggregated pairStats with nested time windows.
            // Prefer the most recent 'last' price we can find in twentyFourHour -> oneHour -> fiveMin
            type PriceWindow = { last?: number | string | null } | undefined
            interface PairStats {
              twentyFourHour?: PriceWindow
              oneHour?: PriceWindow
              fiveMin?: PriceWindow
            }
            const dd = e.data as { pairStats?: PairStats } | undefined
            const ps = dd?.pairStats ?? ({} as PairStats)
            // Use unknown[] to safely narrow each candidate below
            const candidates: unknown[] = [
              ps?.twentyFourHour?.last,
              ps?.oneHour?.last,
              ps?.fiveMin?.last,
            ]
            for (const cand of candidates) {
              if (cand == null) continue
              let num = NaN
              if (typeof cand === 'number') num = cand
              else if (typeof cand === 'string') num = parseFloat(cand)
              // ignore non-number/string candidates
              if (Number.isFinite(num)) {
                newPrice = num
                break
              }
            }
          }
        } catch {}
        const prev = lastPriceRef.current
        const np = newPrice ?? prev // animate regardless; neutral if unchanged
        const color =
          !Number.isFinite(prev) || !Number.isFinite(np)
            ? 'var(--muted, #9CA3AF)'
            : np > prev
              ? 'var(--accent-up)'
              : np < prev
                ? 'var(--accent-down)'
                : 'var(--muted, #9CA3AF)'
        if (Number.isFinite(np)) {
          lastPriceRef.current = np
          try {
            setLatestOverride({ price: np, at: Date.now() })
          } catch {}
        }
        // Pulse the sparkline stroke to the dot color briefly
        pulseColorRef.current = color
        pulseUntilRef.current = Date.now() + 1200
        // Nudge a render so the override/color apply immediately
        setSecTick((n) => n + 1)
        animateDot(color)
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t.chain, (t as { tokenAddress?: string }).tokenAddress])

    function animateDot(color: string) {
      try {
        const eyeEl = eyeRef.current
        const sparkEl = sparkRef.current
        const rowEl = trRef.current
        // When a tick arrives and the row is visible, all three anchors must exist
        if (!isVisibleRef.current) return
        if (!eyeEl || !sparkEl || !rowEl) {
          // Anchors missing; skip quietly to avoid console noise during mount/teardown
          return
        }
        const eyeRect = eyeEl.getBoundingClientRect()
        const sparkRect = sparkEl.getBoundingClientRect()
        const rowRect = rowEl.getBoundingClientRect()
        if (!eyeRect || !sparkRect || !rowRect) {
          // Geometry invalid; abort animation without logging
          return
        }
        const startX = eyeRect.left + eyeRect.width / 2
        const startY = eyeRect.top + eyeRect.height / 2
        const endX = sparkRect.left + sparkRect.width * 0.85 // aim near the right edge of sparkline
        const endY = sparkRect.top + sparkRect.height / 2
        const bottomY = Math.min(window.innerHeight - 4, rowRect.bottom - 4)
        const dot = document.createElement('div')
        dot.setAttribute('aria-hidden', 'true')
        dot.style.position = 'fixed'
        dot.style.left = `${startX}px`
        dot.style.top = `${startY}px`
        dot.style.width = '8px'
        dot.style.height = '8px'
        dot.style.marginLeft = '-4px'
        dot.style.marginTop = '-4px'
        dot.style.borderRadius = '50%'
        dot.style.background = color
        dot.style.pointerEvents = 'none'
        dot.style.zIndex = '9999'
        dot.style.boxShadow = '0 0 8px rgba(0,0,0,0.35)'
        document.body.appendChild(dot)
        const dx = endX - startX
        const dy = endY - startY
        const bottomDy = bottomY - startY
        const duration = 700
        // Two-stage path:
        //  - Quickly drop to the row's bottom (10% progress)
        //  - Travel along bottom until 90%
        //  - Rise to sparkline destination in the last 10%
        const keyframes: Keyframe[] = [
          { transform: 'translate(0px, 0px)', opacity: 0.95, offset: 0 },
          { transform: `translate(${dx * 0.1}px, ${bottomDy}px)`, opacity: 0.9, offset: 0.1 },
          { transform: `translate(${dx * 0.9}px, ${bottomDy}px)`, opacity: 0.35, offset: 0.9 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.2, offset: 1 },
        ]
        const anim: Animation | undefined = dot.animate?.(keyframes, {
          duration,
          easing: 'linear',
          fill: 'forwards',
        })
        const cleanup = () => {
          try {
            if (dot.parentNode) dot.parentNode.removeChild(dot)
          } catch {}
        }
        if (anim && typeof anim.finished?.then === 'function') {
          anim.finished.then(cleanup).catch(cleanup)
        } else {
          // Fallback: manual two-step CSS transition
          const firstMs = Math.round(duration * 0.9)
          const lastMs = duration - firstMs
          // Step 1: move to 90% along bottom
          dot.style.transition = `transform ${firstMs}ms linear, opacity ${firstMs}ms linear`
          requestAnimationFrame(() => {
            dot.style.transform = `translate(${dx * 0.9}px, ${bottomDy}px)`
            dot.style.opacity = '0.35'
          })
          // Step 2: after first phase, rise to destination
          window.setTimeout(() => {
            dot.style.transition = `transform ${lastMs}ms linear, opacity ${lastMs}ms linear`
            dot.style.transform = `translate(${dx}px, ${dy}px)`
            dot.style.opacity = '0.2'
            window.setTimeout(cleanup, lastMs + 40)
          }, firstMs)
        }
      } catch (_err) {
        // Fail fast for animation pipeline issues but avoid throwing into callers
        return
      }
    }

    const auditFlags = {
      verified: t.audit?.contractVerified,
      freezable: t.audit?.freezable,
      renounced: t.audit?.renounced ?? t.security?.renounced,
      locked: t.audit?.locked ?? t.security?.locked,
      honeypot: t.audit?.honeypot,
    }
    return (
      <>
        <tr
          key={composedId + '-token'}
          data-row-id={composedId}
          ref={(el) => {
            // Keep a local ref to the <tr> for visibility events while still registering with Table
            trRef.current = el
            registerRow(el, t)
          }}
          className="token-row"
          {...(getRowStatus?.(t)?.state ? { ['data-row-state']: getRowStatus(t)!.state } : {})}
          {...(idx === rowsLen - 1 ? ({ 'data-last-row': '1' } as Record<string, string>) : {})}
          {...(idx === Math.max(0, rowsLen - 10)
            ? ({ 'data-scroll-trigger': '1' } as Record<string, string>)
            : {})}
        >
          <td>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className="link"
                  onClick={() => {
                    setExpanded((v) => !v)
                  }}
                >
                  <strong title={`${t.tokenName}/${t.tokenSymbol}/${t.chain}`}>
                    {ellipsed(t.tokenName.toUpperCase() + '/' + t.tokenSymbol, 6)}
                  </strong>
                  /{t.chain}
                </span>
                {t.faux ? (
                  <span
                    title="Faux token — receives only local AutoTick events"
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 10,
                      border: '1px solid #4b5563',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'var(--accent-up)',
                      lineHeight: 1.2,
                      marginLeft: 4,
                    }}
                  >
                    FAUX
                  </span>
                ) : null}
              </div>
              <div
                className="muted"
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
              >
                {(() => {
                  const st = getRowStatus?.(t)
                  const tip = st?.tooltip ?? (st ? st.state : '')
                  // Use app accent variables for the indicator: up (subscribed), neutral (unsubscribed), down (disabled)
                  const dotColor =
                    st?.state === 'subscribed'
                      ? 'var(--accent-up)'
                      : st?.state === 'disabled'
                        ? 'var(--accent-down)'
                        : 'var(--muted, #9CA3AF)'
                  return (
                    <span
                      title={tip}
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: dotColor,
                      }}
                    />
                  )
                })()}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setExpanded((v) => !v)
                  }}
                  data-testid={`row-num-#${rowNum}`}
                  title={`Open metadata for row #${rowNum}`}
                  aria-label={`Open metadata for row #${rowNum}`}
                  style={{ padding: '0 6px', fontSize: 16 }}
                >
                  #{rowNum}
                </button>
                {(() => {
                  // Color the details (chart) icon based on row freshness (same rules/colors as DetailModal)
                  interface Timestamps {
                    scannerAt?: unknown
                    tickAt?: unknown
                    pairStatsAt?: unknown
                  }
                  const ts = t as unknown as Timestamps
                  const s = typeof ts.scannerAt === 'number' ? ts.scannerAt : null
                  const ti = typeof ts.tickAt === 'number' ? ts.tickAt : null
                  const p = typeof ts.pairStatsAt === 'number' ? ts.pairStatsAt : null
                  const hasAny = [s, ti, p].some((v) => v != null)
                  const ONE_HOUR_MS = 60 * 60 * 1000
                  const now = Date.now()
                  const recent = [s, ti, p].some(
                    (v) => typeof v === 'number' && now - v < ONE_HOUR_MS,
                  )
                  const freshness: 'fresh' | 'stale' | 'degraded' = hasAny
                    ? recent
                      ? 'fresh'
                      : 'stale'
                    : 'degraded'
                  const iconColor =
                    freshness === 'fresh'
                      ? 'var(--accent-up)'
                      : freshness === 'degraded'
                        ? 'var(--accent-down)'
                        : '#e5e7eb'
                  const label = `Open details (${freshness})`
                  return (
                    <button
                      type="button"
                      data-testid={`open-details-#${rowNum}`}
                      className="link"
                      onClick={() => onOpenRowDetails?.(t)}
                      title={label}
                      aria-label={label}
                    >
                      <ChartNoAxesCombined size={14} style={{ color: iconColor }} />
                    </button>
                  )
                })()}
              </div>
            </div>
          </td>
          <td title={t.exchange} style={{ textAlign: 'center', verticalAlign: 'top' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <Globe size={14} />
              <button
                type="button"
                className={'expand-metadata' + (expanded ? ' expanded' : '')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setExpanded((v) => !v)
                }}
                aria-label={expanded ? 'Hide exchange details' : 'Show exchange details'}
              >
                {expanded ? (
                  <ArrowUpFromLine size={16} color={'var(--accent-down)'} />
                ) : (
                  <ArrowDownFromLine size={16} color={'var(--accent-up)'} />
                )}
              </button>
            </div>
          </td>
          <td colSpan={2} style={{ textAlign: 'right', verticalAlign: 'top' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                alignItems: 'start',
                gap: 4,
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <NumberCell value={t.priceUsd} prefix="$" maxSigDigits={4} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <NumberCell value={t.mcap} prefix="$" maxSigDigits={4} />
              </div>
              {(() => {
                // Single sparkline of Price spanning both Price and MCap columns (no labels)
                // Render a rolling 5-minute window that advances every tick / pulse.
                // If there are no new data points, the line flatlines at the last known value.
                interface MaybeHistory {
                  history?: { ts?: unknown; price?: unknown }
                }
                const h = (t as unknown as MaybeHistory).history
                const tsUnknown = h?.ts
                const pricesUnknown = h?.price
                const tsRaw = Array.isArray(tsUnknown) ? (tsUnknown as (number | string)[]) : []
                const pricesArr = Array.isArray(pricesUnknown)
                  ? (pricesUnknown as (number | string)[]).map((v) => Number(v))
                  : []
                // Normalize timestamps to milliseconds if they look like seconds precision
                const tsArr = tsRaw.map((v) => {
                  const n = Number(v)
                  // Heuristic: Unix seconds are < 1e12 for the foreseeable future; ms are >= 1e12
                  return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n)
                })

                const now = Date.now()
                // Build a higher-resolution series: include all raw history points inside the
                // recent WINDOW_MS (default 5 minutes) without coarse bucketing so short bursts
                // of ticks produce volatility in the sparkline. Cap total points to avoid
                // excessively large arrays (downsample deterministically when needed).
                const WINDOW_MS = 5 * 60_000 // 5 minutes
                const MAX_POINTS = 120

                let data: number[] = []
                if (tsArr.length > 0 && pricesArr.length === tsArr.length) {
                  for (let i = 0; i < tsArr.length; i++) {
                    const ts = tsArr[i]
                    const p = pricesArr[i]
                    if (!Number.isFinite(ts) || !Number.isFinite(p)) continue
                    if (ts >= now - WINDOW_MS) data.push(p)
                  }
                }

                // If no recent points were found, fall back to a small tail from history
                if (data.length === 0 && tsArr.length > 0 && pricesArr.length === tsArr.length) {
                  const take = Math.min(5, pricesArr.length)
                  data = pricesArr.slice(Math.max(0, pricesArr.length - take))
                }

                // Final fallback: use the current price as a tiny flat series so the sparkline renders
                if (data.length === 0) {
                  const base = t.priceUsd
                  data = Array.from({ length: 5 }, () => base)
                }

                // Downsample deterministically when we have too many points
                if (data.length > MAX_POINTS) {
                  const out: number[] = []
                  const step = data.length / MAX_POINTS
                  for (let i = 0; i < MAX_POINTS; i++) {
                    out.push(data[Math.floor(i * step)])
                  }
                  data = out
                }

                // If we have a fresh live override (from incoming tick), apply it to the last point
                try {
                  const ov = latestOverride
                  if (ov && now - ov.at < 60_000) {
                    data[data.length - 1] = ov.price
                  }
                } catch {}

                const height = sparkHeight
                const pad = 2
                const max = Math.max(...data)
                const min = Math.min(...data)
                // const range = Math.max(1e-6, max - min) // unused; kept computation removed
                const len = data.length
                // Prefer the measured sparkWidth so the graph spans the full available cell width
                const w = sparkWidth && sparkWidth > 0 ? sparkWidth : Math.max(60, len * 2)
                const xStep = len > 1 ? (w - pad * 2) / (len - 1) : 0
                const trendUp = data[len - 1] >= data[0]
                let color = trendUp ? 'var(--accent-up)' : 'var(--accent-down)'
                // If a pulse is active, override stroke color temporarily to match the incoming dot
                try {
                  if (pulseUntilRef.current > now && pulseColorRef.current) {
                    color = pulseColorRef.current || color
                  }
                } catch {}
                // Fractional left-shift so the chart advances smoothly each second
                const MINUTE = 60_000
                const secsFrac = (now % MINUTE) / MINUTE
                const offset = secsFrac * xStep
                return (
                  <div style={{ gridColumn: '1 / span 2' }} ref={sparkRef}>
                    <Sparkline
                      data={data}
                      // allow SVG to expand to the full cell width
                      width="100%"
                      height={height}
                      pad={pad}
                      strokeColor={color}
                      strokeWidth={1.5}
                      showDots={true}
                      baseline={true}
                      offsetPx={offset}
                      viewBoxWidth={w}
                      multiplier={sparkMultiplier}
                      ariaLabel={`Price sparkline. Y-axis from $${min.toLocaleString(undefined, {
                        maximumSignificantDigits: 4,
                      })} to $${max.toLocaleString(undefined, { maximumSignificantDigits: 4 })}. Click to open details.`}
                      onClick={() => onOpenRowDetails?.(t)}
                    />
                  </div>
                )
              })()}
            </div>
          </td>
          <td style={{ textAlign: 'right' }}>
            <NumberCell value={t.volumeUsd} maxSigDigits={3} />
          </td>
          <td>
            <div
              className="muted"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2,auto)', gap: 4 }}
            >
              <span
                style={{
                  color: t.priceChangePcs['5m'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
                }}
              >
                {t.priceChangePcs['5m'] >= 0 ? '+' : ''}
                {t.priceChangePcs['5m'].toFixed(1)}%
              </span>
              <span
                style={{
                  color: t.priceChangePcs['1h'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
                }}
              >
                {t.priceChangePcs['1h'] >= 0 ? '+' : ''}
                {t.priceChangePcs['1h'].toFixed(1)}%
              </span>
              <span
                style={{
                  color: t.priceChangePcs['6h'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
                }}
              >
                {t.priceChangePcs['6h'] >= 0 ? '+' : ''}
                {t.priceChangePcs['6h'].toFixed(1)}%
              </span>
              <span
                style={{
                  color: t.priceChangePcs['24h'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
                }}
              >
                {t.priceChangePcs['24h'] >= 0 ? '+' : ''}
                {t.priceChangePcs['24h'].toFixed(2)}%
              </span>
            </div>
          </td>
          <td style={{ textAlign: 'right' }}>{formatAge(t.tokenCreatedTimestamp)}</td>
          <td>
            <div
              className="muted"
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}
            >
              <span
                title="Buys"
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  lineHeight: 1,
                }}
              >
                {/* Colors come from CSS variables */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent-up)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V6" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
                <span>{t.transactions.buys}</span>
              </span>
              <span
                title="Sells"
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  lineHeight: 1,
                }}
              >
                <span>{t.transactions.sells}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent-down)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v13" />
                  <path d="M19 12l-7 7-7-7" />
                </svg>
              </span>
            </div>
          </td>
          <td style={{ textAlign: 'right' }}>
            <NumberCell value={t.liquidity.current} prefix="$" maxSigDigits={3} />
          </td>
          {(() => {
            interface Timestamps {
              scannerAt?: unknown
              tickAt?: unknown
              pairStatsAt?: unknown
            }
            const ts = t as unknown as Timestamps
            const s = typeof ts.scannerAt === 'number' ? ts.scannerAt : null
            const ti = typeof ts.tickAt === 'number' ? ts.tickAt : null
            const p = typeof ts.pairStatsAt === 'number' ? ts.pairStatsAt : null
            const hasAny = [s, ti, p].some((v) => v != null)
            const ONE_HOUR_MS = 60 * 60 * 1000
            const now = Date.now()
            const recent = [s, ti, p].some((v) => typeof v === 'number' && now - v < ONE_HOUR_MS)
            const freshness: 'fresh' | 'stale' | 'degraded' = hasAny
              ? recent
                ? 'fresh'
                : 'stale'
              : 'degraded'
            const freshColor =
              freshness === 'fresh'
                ? 'var(--accent-up)'
                : freshness === 'degraded'
                  ? 'var(--accent-down)'
                  : '#e5e7eb'
            return (
              <>
                <td style={{ textAlign: 'center' }}>
                  {(() => {
                    const st2 = getRowStatus?.(t)
                    const isEnabled = st2?.state === 'subscribed'
                    const title2 = t.faux
                      ? 'Faux token — WS subscription disabled'
                      : isEnabled
                        ? 'click to pause data subscription for this token'
                        : 'click to re-enable data subscription for this token'
                    return (
                      <button
                        type="button"
                        title={title2}
                        aria-label={title2}
                        onClick={t.faux ? undefined : () => onToggleRowSubscription?.(t)}
                        ref={eyeRef}
                        style={{
                          color: t.faux ? 'var(--muted, #9CA3AF)' : freshColor,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          pointerEvents: t.faux ? 'none' : 'auto',
                          opacity: t.faux ? 0.6 : 1,
                        }}
                      >
                        <Eye size={14} />
                        {isEnabled ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                    )
                  })()}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AuditIcons
                      flags={auditFlags}
                      extraIcon={
                        <button
                          type="button"
                          className={'expand-metadata' + (expanded ? ' expanded' : '')}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                          onClick={() => {
                            setExpanded((v) => !v)
                          }}
                          aria-label={expanded ? 'Hide exchange details' : 'Show exchange details'}
                          title={expanded ? 'Hide exchange details' : 'Show exchange details'}
                        >
                          {expanded ? (
                            <ArrowUpFromLine size={16} color={'var(--accent-down)'} />
                          ) : (
                            <ArrowDownFromLine size={16} color={'var(--accent-up)'} />
                          )}
                        </button>
                      }
                    />
                  </div>
                </td>
              </>
            )
          })()}
        </tr>
        {expanded && (
          <tr className="metadata-row" data-testid={`metadata-row-#${rowNum}`}>
            <td
              colSpan={11}
              style={{
                padding: '12px 24px',
                background: 'color-mix(in srgb, var(--token-row-bg), white 12%)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div data-testid={`row-num-expanded-#${rowNum}`} style={{ fontSize: 40 }}>
                  #{rowNum}
                </div>
                <div style={{ fontWeight: 500 }}>Name: ${t.tokenName}</div>
                <div style={{ fontWeight: 500 }}>Symbol: ${t.tokenSymbol}</div>
                <div style={{ fontWeight: 500 }}>Chain: ${t.chain}</div>
                <div style={{ fontWeight: 500 }}>
                  Exchange: {t.exchange || <span style={{ color: 'var(--accent-down)' }}>N/A</span>}
                </div>
                <div
                  className="social-links"
                  data-testid={`social-links-${idx}`}
                  style={{ display: 'flex', flexDirection: 'row', gap: 16 }}
                >
                  <span
                    data-testid={`social-website-${idx}`}
                    title="Website"
                    className={!t.audit?.linkWebsite ? 'no-link' : undefined}
                    style={{
                      color: t.audit?.linkWebsite ? 'var(--accent-up)' : 'var(--accent-down)',
                    }}
                  >
                    {t.audit?.linkWebsite ? (
                      <a
                        className="link"
                        href={t.audit.linkWebsite}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <LinkIcon size={20} />
                      </a>
                    ) : (
                      <LinkIcon size={20} />
                    )}
                  </span>
                  <span
                    data-testid={`social-twitter-${idx}`}
                    title="Twitter"
                    className={!t.audit?.linkTwitter ? 'no-link' : undefined}
                    style={{
                      color: t.audit?.linkTwitter ? 'var(--accent-up)' : 'var(--accent-down)',
                    }}
                  >
                    {t.audit?.linkTwitter ? (
                      <a
                        className="link"
                        href={t.audit.linkTwitter}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <SiX title="Twitter" color="#000000" size={20} />
                      </a>
                    ) : (
                      <SiX title="Twitter" color="#000000" size={20} />
                    )}
                  </span>
                  <span
                    data-testid={`social-telegram-${idx}`}
                    title="Telegram"
                    className={!t.audit?.linkTelegram ? 'no-link' : undefined}
                    style={{
                      color: t.audit?.linkTelegram ? 'var(--accent-up)' : 'var(--accent-down)',
                    }}
                  >
                    {t.audit?.linkTelegram ? (
                      <a
                        className="link"
                        href={t.audit.linkTelegram}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <SiTelegram title="Telegram" color="#0088CC" size={20} />
                      </a>
                    ) : (
                      <SiTelegram title="Telegram" color="#0088CC" size={20} />
                    )}
                  </span>
                  <span
                    data-testid={`social-discord-${idx}`}
                    title="Discord"
                    className={!t.audit?.linkDiscord ? 'no-link' : undefined}
                    style={{
                      color: t.audit?.linkDiscord ? 'var(--accent-up)' : 'var(--accent-down)',
                    }}
                  >
                    {t.audit?.linkDiscord ? (
                      <a
                        className="link"
                        href={t.audit.linkDiscord}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <SiDiscord title="Discord" color="#5865F2" size={20} />
                      </a>
                    ) : (
                      <SiDiscord title="Discord" color="#5865F2" size={20} />
                    )}
                  </span>
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    )
  },
  // Memo comparator: rely on object identity for row and stable scalar props
  (prev, next) =>
    prev.row === next.row &&
    prev.idx === next.idx &&
    prev.rowsLen === next.rowsLen &&
    prev.composedId === next.composedId &&
    prev.getRowStatus === next.getRowStatus &&
    prev.onOpenRowDetails === next.onOpenRowDetails &&
    prev.onToggleRowSubscription === next.onToggleRowSubscription &&
    prev.registerRow === next.registerRow,
)

export default Row
