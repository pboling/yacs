import { ArrowUp, ArrowDown } from 'lucide-react'
import type { ThHTMLAttributes } from 'react'

export type SortKey =
  | 'tokenName'
  | 'exchange'
  | 'priceUsd'
  | 'mcap'
  | 'volumeUsd'
  | 'age'
  | 'tx'
  | 'liquidity'
  | 'fresh'

type Props = {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
} & ThHTMLAttributes<HTMLTableCellElement>

export default function SortHeader({ label, k, sortKey, sortDir, onSort, style, ...rest }: Props) {
  const active = sortKey === k
  const upActive = active && sortDir === 'asc'
  const downActive = active && sortDir === 'desc'
  const upColor = upActive ? 'var(--accent-up)' : '#6b7280'
  const downColor = downActive ? 'var(--accent-down)' : '#6b7280'
  const labelColor = active ? (upActive ? 'var(--accent-up)' : 'var(--accent-down)') : undefined
  const ariaSort: ThHTMLAttributes<HTMLTableCellElement>['aria-sort'] = active
    ? sortDir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  return (
    <th
      onClick={() => {
        onSort(k)
      }}
      aria-sort={ariaSort}
      style={{ cursor: 'pointer', ...style }}
      {...rest}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: labelColor }}>
        <span>{label}</span>
        <ArrowUp size={12} color={upColor} />
        <ArrowDown size={12} color={downColor} />
      </span>
    </th>
  )
}
