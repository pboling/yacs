// src/utils/chain.ts
// Single source of truth for normalizing chain identifiers to numeric string IDs used by the backend.
// Accepts common chain names (ETH, BSC, BASE, SOL) or numeric/string IDs and returns a string ID.
export function toChainId(input: string | number | undefined): string {
  if (input == null) return '1'
  if (typeof input === 'number') return Number.isFinite(input) ? String(input) : '1'
  const s = String(input).toUpperCase().trim()
  if (s === 'ETH') return '1'
  if (s === 'BSC') return '56'
  if (s === 'BASE') return '8453'
  if (s === 'SOL') return '900'
  const n = Number(s)
  return Number.isFinite(n) ? String(n) : '1'
}
