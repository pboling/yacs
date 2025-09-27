import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPairSubscription, buildPairStatsSubscription } from '../src/ws.mapper.js'

// Regression: WS pair subscriptions must use chain names (ETH, BSC, BASE, SOL)
// regardless of whether inputs are names or numeric ids.

const PAIR = '0xPAIR'
const TOKEN = '0xTOKEN'

for (const [input, expected] of [
  ['ETH', 'ETH'],
  ['eth', 'ETH'],
  [1, 'ETH'],
  ['1', 'ETH'],
  ['BSC', 'BSC'],
  [56, 'BSC'],
  ['BASE', 'BASE'],
  [8453, 'BASE'],
  ['SOL', 'SOL'],
  [900, 'SOL'],
]) {
  test(`buildPairSubscription normalizes chain ${String(input)} -> ${expected}`, () => {
    const sub = buildPairSubscription({ pair: PAIR, token: TOKEN, chain: input })
    assert.equal(sub.data.chain, expected)
    const stats = buildPairStatsSubscription({ pair: PAIR, token: TOKEN, chain: input })
    assert.equal(stats.data.chain, expected)
  })
}
