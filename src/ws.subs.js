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
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const pair = typeof it.pairAddress === 'string' ? it.pairAddress : undefined
    const token = typeof it.token1Address === 'string' ? it.token1Address : undefined
    // chainId is a number in ScannerResult; normalize to string to keep payload consistent
    const chainId = typeof it.chainId === 'number' ? String(it.chainId) : (typeof it.chainId === 'string' ? it.chainId : undefined)
    if (!pair || !token || !chainId) continue
    const key = pair + '|' + token + '|' + chainId
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ pair, token, chain: chainId })
  }
  return out
}
