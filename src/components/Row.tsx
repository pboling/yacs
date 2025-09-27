import { memo } from 'react'
import NumberCell from './NumberCell'
import AuditIcons from './AuditIcons'
import { Globe, MessageCircle, Send, ExternalLink, Eye, ChartNoAxesCombined } from 'lucide-react'
import { BurnDetailsTooltip } from './BurnDetailsTooltip'
import { formatAge } from '../helpers/format'
import type { Token as TokenRow } from '../models/Token'

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
  showBurnTooltipIdx: number | null
  setShowBurnTooltipIdx: (v: number | null) => void
  registerRow: (el: HTMLTableRowElement | null, row: TokenRow) => void
}

function ellipsed(input: string, length = 5) {
  if (length <= 0) return ''
  if (input.length <= length) return input
  return input.slice(0, Math.max(1, length - 1)) + '…'
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
    showBurnTooltipIdx,
    setShowBurnTooltipIdx,
    registerRow,
  }: RowProps) {
    const auditFlags = {
      verified: t.audit?.contractVerified,
      freezable: t.audit?.freezable,
      renounced: t.audit?.renounced ?? t.security?.renounced,
      locked: t.audit?.locked ?? t.security?.locked,
      burned: t.audit?.burned ?? t.security?.burned,
      honeypot: t.audit?.honeypot,
    }
    return (
      <tr
        key={composedId}
        data-row-id={composedId}
        ref={(el) => {
          registerRow(el, t)
        }}
        {...(idx === rowsLen - 1 ? ({ 'data-last-row': '1' } as Record<string, string>) : {})}
        {...(idx === Math.max(0, rowsLen - 10)
          ? ({ 'data-scroll-trigger': '1' } as Record<string, string>)
          : {})}
      >
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>
                <strong title={`${t.tokenName}/${t.tokenSymbol}/${t.chain}`}>
                  {ellipsed(t.tokenName.toUpperCase() + '/' + t.tokenSymbol, 6)}
                </strong>
                /{t.chain}
              </span>
            </div>
            <div
              className="muted"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
            >
              {(() => {
                const st = getRowStatus?.(t)
                const tip = st?.tooltip || (st ? st.state : '')
                const dotColor =
                  st?.state === 'subscribed'
                    ? '#10b981'
                    : st?.state === 'disabled'
                      ? '#6b7280'
                      : '#f59e0b'
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
                onClick={() => onOpenRowDetails?.(t)}
                title={`Open details for row #${idx + 1}`}
                aria-label={`Open details for row #${idx + 1}`}
                style={{ padding: '0 6px', fontSize: 11 }}
              >
                {idx + 1}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => onOpenRowDetails?.(t)}
                title="Open details"
                aria-label="Open details"
              >
                <ChartNoAxesCombined size={14} />
              </button>
            </div>
          </div>
        </td>
        <td title={t.exchange} style={{ textAlign: 'center' }}>
          <Globe size={14} />
        </td>
        <td style={{ textAlign: 'right' }}>
          <NumberCell value={t.priceUsd} prefix="$" />
        </td>
        <td style={{ textAlign: 'right' }}>
          <NumberCell value={t.mcap} prefix="$" />
        </td>
        <td style={{ textAlign: 'right' }}>
          <NumberCell value={t.volumeUsd} />
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
              {t.priceChangePcs['5m'].toFixed(2)}%
            </span>
            <span
              style={{
                color: t.priceChangePcs['1h'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
              }}
            >
              {t.priceChangePcs['1h'] >= 0 ? '+' : ''}
              {t.priceChangePcs['1h'].toFixed(2)}%
            </span>
            <span
              style={{
                color: t.priceChangePcs['6h'] >= 0 ? 'var(--accent-up)' : 'var(--accent-down)',
              }}
            >
              {t.priceChangePcs['6h'] >= 0 ? '+' : ''}
              {t.priceChangePcs['6h'].toFixed(2)}%
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
        <td>{formatAge(t.tokenCreatedTimestamp)}</td>
        <td>
          <div className="muted" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <span title="Buys">
              {}
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
              </svg>{' '}
              {t.transactions.buys}
            </span>
            <span title="Sells">
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
              </svg>{' '}
              {t.transactions.sells}
            </span>
          </div>
        </td>
        <td style={{ textAlign: 'right' }}>
          <NumberCell value={t.liquidity.current} prefix="$" />
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AuditIcons flags={auditFlags} />
            {t.burnDetails && (
              <div
                onMouseEnter={() => {
                  setShowBurnTooltipIdx(idx)
                }}
                onMouseLeave={() => {
                  setShowBurnTooltipIdx(null)
                }}
                style={{ position: 'relative' }}
              >
                <span className="muted" style={{ fontSize: 12, cursor: 'help' }}>
                  Burn
                </span>
                {showBurnTooltipIdx === idx && (
                  <div style={{ position: 'absolute', zIndex: 10, top: '120%', right: 0 }}>
                    <BurnDetailsTooltip details={t.burnDetails} />
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              title="Toggle subscription for this row"
              onClick={() => onToggleRowSubscription?.(t)}
            >
              <Eye size={14} />
            </button>
            {t.twitter && (
              <a className="link" href={t.twitter} target="_blank" rel="noreferrer" title="Twitter">
                <MessageCircle size={14} />
              </a>
            )}
            {t.website && (
              <a className="link" href={t.website} target="_blank" rel="noreferrer" title="Website">
                <ExternalLink size={14} />
              </a>
            )}
            {t.tgLink && (
              <a className="link" href={t.tgLink} target="_blank" rel="noreferrer" title="Telegram">
                <Send size={14} />
              </a>
            )}
          </div>
        </td>
      </tr>
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
    prev.showBurnTooltipIdx === next.showBurnTooltipIdx &&
    prev.registerRow === next.registerRow,
)

export default Row
