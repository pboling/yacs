import { describe, it, expect } from 'vitest'
import { buildPairKey, buildTickKey } from '../src/utils/key_builder'

describe('key_builder normalization', () => {
  it('buildTickKey lowercases token and preserves chain id', () => {
    const token = '0xAbC123'
    const chain = 'ETH'
    const key = buildTickKey(token, chain)
    expect(key).toBe('0xabc123|1')
  })

  it('buildPairKey lowercases pair and token and includes chain id', () => {
    const pair = '0xPAIR'
    const token = '0xToKen'
    const chain = 56
    const key = buildPairKey(pair, token, chain)
    expect(key).toBe('0xpair|0xtoken|56')
  })
})

