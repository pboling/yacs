import { describe, it, expect } from 'vitest'
import { tokensReducer, initialState } from '../src/tokens.reducer.js'

describe('tokens.reducer pair/stats price update', () => {
  it('applies priceUsd and mcap when pair-stats contains last windows', () => {
    const idOrig = '0x1234567890123456789012345678901234567890'
    const id = idOrig.toLowerCase()
    const existingToken = {
      id: idOrig,
      tokenName: 'TestToken',
      tokenSymbol: 'TT',
      chain: 'ETH',
      exchange: 'uniswap',
      priceUsd: 1.0,
      mcap: 1000,
      volumeUsd: 0,
      priceChangePcs: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
      tokenCreatedTimestamp: new Date(),
      transactions: { buys: 0, sells: 0 },
      liquidity: { current: 0, changePc: 0 },
      pairAddress: idOrig,
      tokenAddress: '0xdead',
      audit: {},
      security: {},
      history: { ts: [], price: [], mcap: [], volume: [], buys: [], sells: [], liquidity: [] },
    }

    const state = {
      ...initialState,
      byId: { [id]: existingToken, [idOrig]: existingToken },
      meta: {},
    }

    const pairStatsAction = {
      type: 'pair/stats',
      payload: {
        data: {
          pair: { pairAddress: idOrig },
          pairStats: {
            twentyFourHour: { last: null },
            oneHour: { last: '2.5' },
            fiveMin: { last: null },
          },
          migrationProgress: '0',
        },
      },
    }

    const next = tokensReducer(state as any, pairStatsAction as any)

    expect(next.byId[id].priceUsd).toBeCloseTo(2.5)
    expect(next.byId[id].mcap).toBeCloseTo(2500)
  })
})

