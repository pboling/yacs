import { describe, it, expect } from 'vitest';
import {
  calcMarketCapFromResponse,
  mapRESTScannerResultToToken,
  applyTickToToken,
} from '../src/tdd.runtime.js';

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
  };
}

describe('tdd.runtime', () => {
  it('calcMarketCapFromResponse respects priority order', () => {
    const s1 = baseScanner({
      currentMcap: '0',
      initialMcap: '5',
      pairMcapUsd: '3',
      pairMcapUsdInitial: '2',
    })
    expect(calcMarketCapFromResponse(s1)).toBe(5)
    const s2 = baseScanner({
      currentMcap: '100',
      initialMcap: '5',
      pairMcapUsd: '3',
      pairMcapUsdInitial: '2',
    })
    expect(calcMarketCapFromResponse(s2)).toBe(100)
    const s3 = baseScanner({
      currentMcap: '0',
      initialMcap: '0',
      pairMcapUsd: '3.14',
      pairMcapUsdInitial: '2',
    })
    expect(calcMarketCapFromResponse(s3)).toBe(3.14)
    const s4 = baseScanner({
      currentMcap: '0',
      initialMcap: '0',
      pairMcapUsd: '0',
      pairMcapUsdInitial: '7',
    })
    expect(calcMarketCapFromResponse(s4)).toBe(7)
    const s5 = baseScanner({
      currentMcap: '0',
      initialMcap: '0',
      pairMcapUsd: '0',
      pairMcapUsdInitial: '0',
    })
    expect(calcMarketCapFromResponse(s5)).toBe(0)
  })

  it('mapRESTScannerResultToToken maps core fields correctly', () => {
    const s = baseScanner({
      currentMcap: '0',
      initialMcap: '0',
      pairMcapUsd: '42',
      price: '1.5',
      buys: 10,
      sells: 5,
    })
    const t = mapRESTScannerResultToToken(s)
    expect(t.id).toBe('0xPAIR')
    expect(t.tokenName).toBe('My Token')
    expect(t.tokenSymbol).toBe('MTK')
    expect(t.tokenAddress).toBe('0xTOKEN')
    expect(t.pairAddress).toBe('0xPAIR')
    expect(t.chain).toBe('ETH')
    expect(t.exchange).toBe('0xROUTER')
    expect(t.priceUsd).toBe(1.5)
    expect(t.volumeUsd).toBe(9999.5)
    expect(t.mcap).toBe(42)
    expect(t.priceChangePcs).toEqual({ '5m': 0.5, '1h': 1.1, '6h': 0.9, '24h': 2.2 })
    expect(t.transactions).toEqual({ buys: 10, sells: 5 })
    expect(t.audit).toEqual({
      mintable: false,
      freezable: true,
      honeypot: false,
      contractVerified: true,
    })
    expect(t.tokenCreatedTimestamp.toISOString()).toBe(s.age)
    expect(t.liquidity).toEqual({ current: 12345.67, changePc: 3.3 })
  })

  it('applyTickToToken uses latest non-outlier swap and updates price, mcap, volume and tx counts', () => {
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
    expect(updated.priceUsd).toBe(1.3)
    expect(updated.mcap).toBe(1300000)
    // volume delta = sum(|amountToken1| * price1Usd) for non-outliers: 100*1.2 + 50*1.3 = 120 + 65 = 185
    expect(Math.round((updated.volumeUsd - token.volumeUsd) * 1000) / 1000).toBe(185)
    // buys: tokenIn === token0 (0xWETH) => 1; sells: tokenIn === token1 => 1
    expect(updated.transactions.buys - token.transactions.buys).toBe(1)
    expect(updated.transactions.sells - token.transactions.sells).toBe(1)
  })
})
