/*
  ws.subs.js
  Utilities for WebSocket subscription payloads. Currently exposes a helper to
  derive unique {pair, token, chain} tuples from scanner results for subscribing.
*/
// Utility helpers related to WebSocket subscriptions
// This module provides a small helper to compute payloads for pair-related
// subscriptions based on the scanner results.
// Implemented in JS to keep runtime simple while TS consumers can narrow types.

import { toChainName } from './utils/chain.js'

/**
 * Compute unique { pair, token, chain } payloads from a list of items.
 * The function is defensive: it accepts any array and tries to extract
 * the expected fields when present.
 *
 * Case-insensitive behavior:
 * - Dedupe by lowercasing pair/token for the key, but preserve the original
 *   casing in the output (so the common "0x" prefix stays lowercase when present).
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
    const chainIdNum =
      typeof it.chainId === 'number'
        ? it.chainId
        : typeof it.chainId === 'string'
          ? Number(it.chainId)
          : undefined
    if (!pair || !token || chainIdNum == null || Number.isNaN(chainIdNum)) continue

    const chain = toChainName(chainIdNum)

    // Case-insensitive de-dupe using lowercased addresses for the key
    const normKey = pair.toLowerCase() + '|' + token.toLowerCase() + '|' + chain
    if (!seen.has(normKey)) {
      seen.add(normKey)
      // Preserve original casing from the first occurrence to match expected key strings
      out.push({ pair, token, chain })
    }
  }
  return out
}
