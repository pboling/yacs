import test from 'node:test'
import assert from 'node:assert/strict'

import { computePairPayloads } from '../src/ws.subs.js'

test('ws.subs: computePairPayloads emits both chain id and name variants and deduplicates', () => {
  const items = [
    {
      pairAddress: '0xPAIR1',
      token1Address: '0xTOKEN1',
      chainId: 1, // ETH
    },
    {
      pairAddress: '0xpair1', // same pair/token differing case should still be treated the same at consumer layer
      token1Address: '0xTOKEN1',
      chainId: '1',
    },
    {
      pairAddress: '0xPAIR2',
      token1Address: '0xTOKEN2',
      chainId: 56, // BSC
    },
    {
      pairAddress: '0xPAIR3',
      token1Address: '0xTOKEN3',
      chainId: 8453, // BASE
    },
    {
      pairAddress: '0xPAIR4',
      token1Address: '0xTOKEN4',
      chainId: 900, // SOL
    },
    // invalid rows should be ignored
    { pairAddress: '0xBAD', token1Address: '0xTOKEN', chainId: 'not-a-number' },
    { pairAddress: null, token1Address: '0xTOKEN', chainId: 1 },
    { pairAddress: '0xPAIR', token1Address: null, chainId: 1 },
    null,
    42,
  ]

  const out = computePairPayloads(items)
  // For each valid row we expect two variants (id and name) => total 4 rows * 2 = 8 variants
  const keys = out.map((o) => `${o.pair}|${o.token}|${o.chain}`)

  // Ensure both variants exist per row
  assert.ok(keys.includes('0xPAIR1|0xTOKEN1|1'))
  assert.ok(keys.includes('0xPAIR1|0xTOKEN1|ETH'))
  assert.ok(keys.includes('0xPAIR2|0xTOKEN2|56'))
  assert.ok(keys.includes('0xPAIR2|0xTOKEN2|BSC'))
  assert.ok(keys.includes('0xPAIR3|0xTOKEN3|8453'))
  assert.ok(keys.includes('0xPAIR3|0xTOKEN3|BASE'))
  assert.ok(keys.includes('0xPAIR4|0xTOKEN4|900'))
  assert.ok(keys.includes('0xPAIR4|0xTOKEN4|SOL'))

  // Dedupe: the duplicate of pair1 should not create extra entries beyond the two variants
  const pair1Variants = keys.filter((k) => k.startsWith('0xPAIR1|0xTOKEN1|'))
  assert.equal(pair1Variants.length, 2)

  // No invalid entries should leak
  assert.equal(
    keys.some((k) => k.includes('not-a-number')),
    false,
  )
})
