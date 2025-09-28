import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScannerQuery, mapScannerPage, fetchScanner } from '../src/scanner.client.js';

function makeScanner(overrides = {}) {
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
    price: '1.5',
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

const sampleResponse = {
  pairs: [
    makeScanner(),
    makeScanner({
      pairAddress: '0xPAIR2',
      token1Address: '0xTOKEN2',
      token1Symbol: 'TK2',
      token1Name: 'Token2',
    }),
  ],
  page: 1,
  totalPages: 5,
}

test('scanner.client.js utilities', async (t) => {
  await t.test('buildScannerQuery serializes primitives and arrays', () => {
    const qp = buildScannerQuery({ chain: 'ETH', page: 2, dexes: ['uni', 'ray'], isNotHP: true })
    const s = qp.toString()
    assert.match(s, /chain=ETH/)
    assert.match(s, /page=2/)
    // array becomes repeated params
    assert.equal((s.match(/dexes=/g) || []).length, 2)
    assert.match(s, /isNotHP=true/)
  })

  await t.test('mapScannerPage maps ScannerPairs to TokenData[]', () => {
    const tokens = mapScannerPage(sampleResponse)
    assert.equal(tokens.length, 2)
    assert.equal(tokens[0].pairAddress, '0xPAIR')
    assert.equal(tokens[1].tokenSymbol, 'TK2')
  })

  await t.test('fetchScanner uses injected fetch and maps tokens', async () => {
    const calls = []
    const mockFetch = async (url) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => sampleResponse,
      }
    }
    const { raw, tokens } = await fetchScanner(
      { chain: 'ETH', page: 1 },
      { baseUrl: 'https://mock', fetchImpl: mockFetch },
    )
    assert.deepEqual(raw, sampleResponse)
    assert.equal(tokens.length, 2)
    assert.match(calls[0], /^https:\/\/mock\/scanner\?/)
  })
})
