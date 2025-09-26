// src/utils/keys.ts
import { toChainId } from './chain'

export function buildPairKey(pair: string, token: string, chain: string | number | undefined) {
  return `${pair}|${token}|${toChainId(chain)}`
}

export function buildTickKey(token: string, chain: string | number | undefined) {
  return `${token}|${toChainId(chain)}`
}
