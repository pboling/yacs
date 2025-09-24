import test from 'node:test'
import assert from 'node:assert/strict'
import { tokensReducer, initialState, actions } from '../src/tokens.reducer.js'

function mkScanner(overrides = {}) {
  return {
    age: new Date('2025-01-01T00:00:00Z').toISOString(),
    bundlerHoldings: '0',
    callCount: 0,
    chainId: 1,
    contractRenounced: false,
    contractVerified: true,
    currentMcap: '0',
    devHoldings: '0',
    dexPaid: false,
    diff1H: '1.1',
    diff24H: '2.2',
    diff5M: '0.5',
    diff6H: '0.9',
    fdv: '0',
    first1H: '0',
    first24H: '0',
    first5M: '0',
    first6H: '0',
    honeyPot: false,
    initialMcap: '0',
    insiderHoldings: '0',
    insiders: 0,
    isFreezeAuthDisabled: false,
    isMintAuthDisabled: true,
    liquidity: '12345.67',
    liquidityLocked: false,
    liquidityLockedAmount: '0',
    liquidityLockedRatio: '0',
    migratedFromVirtualRouter: null,
    virtualRouterType: null,
    pairAddress: '0xPAIR',
    pairMcapUsd: '42',
    pairMcapUsdInitial: '0',
    percentChangeInLiquidity: '3.3',
    percentChangeInMcap: '0',
    price: '1.0',
    reserves0: '0',
    reserves0Usd: '0',
    reserves1: '0',
    reserves1Usd: '0',
    routerAddress: '0xROUTER',
    sniperHoldings: '0',
    snipers: 0,
    token0Decimals: 18,
    token0Symbol: 'WETH',
    token1Address: '0xTOKEN',
    token1Decimals: '18',
    token1Name: 'My Token',
    token1Symbol: 'MTK',
    token1TotalSupplyFormatted: '1000000',
    top10Holdings: '0',
    txns: 0,
    volume: '100',
    ...overrides,
  }
}

test('scanner/pairs ingests page and preserves live-updated price/mcap on refresh', () => {
  const page1 = [mkScanner()]
  let state = tokensReducer(initialState, actions.scannerPairs(1, page1))
  const id = '0xPAIR'
  // simulate live update
  const updated = { ...state.byId[id], priceUsd: 1.5, mcap: 1500000 }
  state = { ...state, byId: { ...state.byId, [id]: updated } }
  // refresh with new scanner data (price=1.0) should preserve 1.5
  state = tokensReducer(state, actions.scannerPairs(1, page1))
  assert.equal(state.byId[id].priceUsd, 1.5)
  assert.equal(state.pages[1][0], id)
})

test('pair/tick updates price, mcap, volume and persists token0Address meta', () => {
  const page1 = [mkScanner({ price: '1.0' })]
  let state = tokensReducer(initialState, actions.scannerPairs(1, page1))
  const swaps = [
    { timestamp: '1', addressTo: '', addressFrom: '', token0Address: '0xWETH', amountToken0: '1', amountToken1: '100', priceToken0Usd: '3000', priceToken1Usd: '1.2', tokenInAddress: '0xWETH', isOutlier: false },
    { timestamp: '2', addressTo: '', addressFrom: '', token0Address: '0xWETH', amountToken0: '1', amountToken1: '50', priceToken0Usd: '3000', priceToken1Usd: '1.3', tokenInAddress: '0xTOKEN', isOutlier: false },
  ]
  state = tokensReducer(state, actions.tick({ pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }, swaps))
  const t = state.byId['0xPAIR']
  assert.equal(t.priceUsd, 1.3)
  assert.ok(state.meta['0xPAIR'].token0Address === '0xWETH')
})

test('pair/stats merges audit flags', () => {
  const page1 = [mkScanner()]
  let state = tokensReducer(initialState, actions.scannerPairs(1, page1))
  const msg = {
    pair: {
      pairAddress: '0xPAIR',
      isVerified: true,
      token1IsHoneypot: true,
      mintAuthorityRenounced: false,
      freezeAuthorityRenounced: true,
    },
    pairStats: {},
    migrationProgress: '0',
    callCount: 1,
  }
  state = tokensReducer(state, actions.pairStats(msg))
  const a = state.byId['0xPAIR'].audit
  assert.equal(a.honeypot, true)
  assert.equal(a.contractVerified, true)
  assert.equal(a.mintable, true)
  assert.equal(a.freezable, false)
})
