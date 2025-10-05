// src/utils/chain.js
// JavaScript version for CommonJS/ESM compatibility
// Mirrors chain.ts for JS modules that can't import .ts directly

/**
 * Convert chain identifier to numeric string ID.
 * @param {string | number | undefined} input
 * @returns {string}
 */
export function toChainId(input) {
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

/**
 * Convert chain ID to human-readable chain name.
 * @param {string | number | undefined} input
 * @returns {string}
 */
export function toChainName(input) {
  if (input == null) return 'ETH'

  if (typeof input === 'string') {
    const upper = input.toUpperCase().trim()
    if (upper === 'ETH' || upper === 'BSC' || upper === 'BASE' || upper === 'SOL') {
      return upper
    }
  }

  const numericId = typeof input === 'number' ? input : Number(input)

  switch (numericId) {
    case 1:
      return 'ETH'
    case 56:
      return 'BSC'
    case 8453:
      return 'BASE'
    case 900:
      return 'SOL'
    default:
      return String(input).toUpperCase()
  }
}

