import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcMarketCapFromResponse,
  mapRESTScannerResultToToken,
  applyTickToToken,
} from '../src/tdd.runtime.js'

function baseScanner(overrides = {}) {
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
    pairMcapUsd: '0',
    pairMcapUsdInitial: '0',
    percentChangeInLiquidity: '3.3',
    percentChangeInMcap: '0',
    price: '0.1234',
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
    volume: '9999.5',
    ...overrides,
  }
}

test('calcMarketCapFromResponse respects priority order', () => {
  const s1 = baseScanner({
    currentMcap: '0',
    initialMcap: '5',
    pairMcapUsd: '3',
    pairMcapUsdInitial: '2',
  })
  assert.equal(calcMarketCapFromResponse(s1), 5)
  const s2 = baseScanner({
    currentMcap: '100',
    initialMcap: '5',
    pairMcapUsd: '3',
    pairMcapUsdInitial: '2',
  })
  assert.equal(calcMarketCapFromResponse(s2), 100)
  const s3 = baseScanner({
    currentMcap: '0',
    initialMcap: '0',
    pairMcapUsd: '3.14',
    pairMcapUsdInitial: '2',
  })
  assert.equal(calcMarketCapFromResponse(s3), 3.14)
  const s4 = baseScanner({
    currentMcap: '0',
    initialMcap: '0',
    pairMcapUsd: '0',
    pairMcapUsdInitial: '7',
  })
  assert.equal(calcMarketCapFromResponse(s4), 7)
  const s5 = baseScanner({
    currentMcap: '0',
    initialMcap: '0',
    pairMcapUsd: '0',
    pairMcapUsdInitial: '0',
  })
  assert.equal(calcMarketCapFromResponse(s5), 0)
})

test('mapRESTScannerResultToToken maps core fields correctly', () => {
  const s = baseScanner({
    currentMcap: '0',
    initialMcap: '0',
    pairMcapUsd: '42',
    price: '1.5',
    buys: 10,
    sells: 5,
  })
  const t = mapRESTScannerResultToToken(s)
  assert.equal(t.id, '0xPAIR')
  assert.equal(t.tokenName, 'My Token')
  assert.equal(t.tokenSymbol, 'MTK')
  assert.equal(t.tokenAddress, '0xTOKEN')
  assert.equal(t.pairAddress, '0xPAIR')
  assert.equal(t.chain, 'ETH')
  assert.equal(t.exchange, '0xROUTER')
  assert.equal(t.priceUsd, 1.5)
  assert.equal(t.volumeUsd, 9999.5)
  assert.equal(t.mcap, 42)
  assert.deepEqual(t.priceChangePcs, { '5m': 0.5, '1h': 1.1, '6h': 0.9, '24h': 2.2 })
  assert.deepEqual(t.transactions, { buys: 10, sells: 5 })
  assert.deepEqual(t.audit, {
    mintable: false,
    freezable: true,
    honeypot: false,
    contractVerified: true,
  })
  assert.equal(t.tokenCreatedTimestamp.toISOString(), s.age)
  assert.deepEqual(t.liquidity, { current: 12345.67, changePc: 3.3 })
})

test('applyTickToToken uses latest non-outlier swap and updates price, mcap, volume and tx counts', () => {
  const s = baseScanner({ price: '1.0' })
  const token = mapRESTScannerResultToToken(s)
  const swaps = [
    {
      timestamp: '1',
      addressTo: '',
      addressFrom: '',
      token0Address: '0xWETH',
      amountToken0: '1',
      amountToken1: '100',
      priceToken0Usd: '3000',
      priceToken1Usd: '1.1',
      tokenInAddress: '0xTOKEN',
      isOutlier: true,
    },
    {
      timestamp: '2',
      addressTo: '',
      addressFrom: '',
      token0Address: '0xWETH',
      amountToken0: '1',
      amountToken1: '100',
      priceToken0Usd: '3000',
      priceToken1Usd: '1.2',
      tokenInAddress: '0xWETH',
      isOutlier: false,
    },
    {
      timestamp: '3',
      addressTo: '',
      addressFrom: '',
      token0Address: '0xWETH',
      amountToken0: '1',
      amountToken1: '50',
      priceToken0Usd: '3000',
      priceToken1Usd: '1.3',
      tokenInAddress: '0xTOKEN',
      isOutlier: false,
    },
  ]
  const updated = applyTickToToken(token, swaps, {
    totalSupply: 1000000,
    token0Address: '0xWETH',
    token1Address: '0xTOKEN',
  })
  // latest non-outlier is the last one (price 1.3)
  assert.equal(updated.priceUsd, 1.3)
  assert.equal(updated.mcap, 1300000)
  // volume delta = sum(|amountToken1| * price1Usd) for non-outliers: 100*1.2 + 50*1.3 = 120 + 65 = 185
  assert.equal(Math.round((updated.volumeUsd - token.volumeUsd) * 1000) / 1000, 185)
  // buys: tokenIn === token0 (0xWETH) => 1; sells: tokenIn === token1 => 1
  assert.equal(updated.transactions.buys - token.transactions.buys, 1)
  assert.equal(updated.transactions.sells - token.transactions.sells, 1)
})
