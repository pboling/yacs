import { computePairPayloads } from '../src/ws.subs.js'

const items = [
  { pairAddress: '0xPAIR1', token1Address: '0xTOKEN1', chainId: 1 },
  { pairAddress: '0xpair1', token1Address: '0xTOKEN1', chainId: '1' },
  { pairAddress: '0xPAIR2', token1Address: '0xTOKEN2', chainId: 56 },
  { pairAddress: '0xPAIR3', token1Address: '0xTOKEN3', chainId: 8453 },
  { pairAddress: '0xPAIR4', token1Address: '0xTOKEN4', chainId: 900 },
  { pairAddress: '0xBAD', token1Address: '0xTOKEN', chainId: 'not-a-number' },
  { pairAddress: null, token1Address: '0xTOKEN', chainId: 1 },
  { pairAddress: '0xPAIR', token1Address: null, chainId: 1 },
  null,
  42,
]

const out = computePairPayloads(items)
const keys = out.map((o) => `${o.pair}|${o.token}|${o.chain}`)
console.log('out.length =', out.length)
console.log('keys =', keys)
console.log('contains 0xPAIR1|0xTOKEN1|ETH:', keys.includes('0xPAIR1|0xTOKEN1|ETH'))
const pair1Variants = keys.filter((k) => k.startsWith('0xPAIR1|0xTOKEN1|'))
console.log('pair1Variants.length =', pair1Variants.length)

