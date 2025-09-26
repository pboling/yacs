// Utility helpers related to WebSocket subscriptions
// This module provides a small helper to compute payloads for pair-related
// subscriptions based on the scanner results.
// Implemented in JS to keep runtime simple while TS consumers can narrow types.

/**
 * Compute unique { pair, token, chain } payloads from a list of items.
 * The function is defensive: it accepts any array and tries to extract
 * the expected fields when present.
 *
 * @param {Array<any>} items
 * @returns {{ pair: string, token: string, chain: string }[]}
 */
export function computePairPayloads(items) {
  if (!Array.isArray(items)) return []
  const out = []
  const seen = new Set()

  const idToName = (id) => {
    switch (Number(id)) {
      case 1:
        return 'ETH'
      case 56:
        return 'BSC'
      case 8453:
        return 'BASE'
      case 900:
        return 'SOL'
      default:
        return String(id)
    }
  }

  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const pair = typeof it.pairAddress === 'string' ? it.pairAddress : undefined
    const token = typeof it.token1Address === 'string' ? it.token1Address : undefined
    const chainIdNum =
      typeof it.chainId === 'number'
        ? it.chainId
        : typeof it.chainId === 'string'
          ? Number(it.chainId)
          : undefined
    if (!pair || !token || chainIdNum == null || Number.isNaN(chainIdNum)) continue

    const chainIdStr = String(chainIdNum)
    const chainName = idToName(chainIdNum)

    // Emit both variants to be compatible with servers expecting either numeric id or name
    const variants = [chainIdStr, chainName]
    for (const chain of variants) {
      const key = pair + '|' + token + '|' + chain
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ pair, token, chain })
    }
  }
  return out
}
