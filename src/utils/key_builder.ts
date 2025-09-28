// src/utils/keys.ts
import { toChainId } from './chain'

export function buildPairKey(pair: string, token: string, chain: string | number | undefined) {
  // Normalize pair and token to lowercase to ensure consistent keying across emitters and listeners
  const p = pair.toLowerCase()
  const t = token.toLowerCase()
  return `${p}|${t}|${toChainId(chain)}`
}

export function buildTickKey(token: string, chain: string | number | undefined) {
  const t = token.toLowerCase()
  return `${t}|${toChainId(chain)}`
}
