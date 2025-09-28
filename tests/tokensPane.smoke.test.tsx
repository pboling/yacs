import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import TokensPane from '../src/components/TokensPane'
import fs from 'node:fs/promises'

// Minimal Token type consistent with UI usage
interface TokenRow {
  id: string
  tokenName: string
  tokenSymbol: string
  chain: string
  exchange: string
  priceUsd: number
  mcap: number
  volumeUsd: number
  priceChangePcs: { '5m': number; '1h': number; '6h': number; '24h': number }
  transactions: { buys: number; sells: number }
  liquidity: { current: number; changePc: number }
  tokenCreatedTimestamp: Date
}

import path from 'node:path'

async function loadFixture(name: 'scanner.trending.json' | 'scanner.new.json') {
  const p = path.resolve(process.cwd(), 'tests', 'fixtures', name)
  const txt = await fs.readFile(p, 'utf-8')
  return JSON.parse(txt)
}

// We will mock the module that TokensPane imports (../scanner.client.js)
vi.mock('../src/scanner.client.js', async (orig) => {
  const mod = await (orig as any)()
  const real = mod as Record<string, any>
  return {
    ...real,
    fetchScanner: async (params: Record<string, any>) => {
      const which = params?.rankBy === 'volume' ? 'scanner.trending.json' : 'scanner.new.json'
      const raw = await loadFixture(which as any)
      // Use local mapScannerPage to convert fixture data
      const tokens = mapScannerPage(raw)
      return { raw: { scannerPairs: tokens }, tokens }
    },
  }
})

// Light-weight environment stubs used by Table inside TokensPane
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Helper to build minimal state object
function makeState(): {
  byId: Record<string, TokenRow | undefined>
  pages: Record<number, string[]>
  version?: number
} {
  return { byId: {}, pages: {}, version: 0 }
}

// Map the fixture's 'pairs' array to the expected token object format
function toChainName(v: any): string {
  const n = Number(v)
  if (v === 'ETH' || v === 'BSC' || v === 'BASE' || v === 'SOL') return v
  switch (n) {
    case 1:
      return 'ETH'
    case 56:
      return 'BSC'
    case 8453:
      return 'BASE'
    case 900:
      return 'SOL'
    default:
      return 'ETH'
  }
}

function mapScannerPage(raw: any) {
  return Array.isArray(raw.pairs)
    ? raw.pairs.map((pair: any) => ({
        id: pair.pairAddress,
        tokenName: pair.token1Name,
        tokenSymbol: pair.token1Symbol,
        chain: toChainName(pair.chainId),
        exchange: pair.routerAddress,
        priceUsd: Number(pair.price),
        mcap: Number(pair.currentMcap),
        volumeUsd: Number(pair.volume),
        priceChangePcs: {
          '5m': Number(pair.diff5M),
          '1h': Number(pair.diff1H),
          '6h': Number(pair.diff6H),
          '24h': Number(pair.diff24H),
        },
        transactions: { buys: pair.buys, sells: pair.sells },
        liquidity: { current: Number(pair.liquidity), changePc: Number(pair.percentChangeInLiquidity) },
        tokenCreatedTimestamp: new Date(pair.age),
      }))
    : []
}

describe.skip('TokensPane smoke: dispatches after successful fetch', () => {
  const origIO = (global as any).IntersectionObserver
  const origRO = (global as any).ResizeObserver

  beforeEach(() => {
    ;(global as any).IntersectionObserver = IO as any
    ;(global as any).ResizeObserver = IO as any
  })
  afterEach(() => {
    ;(global as any).IntersectionObserver = origIO
    ;(global as any).ResizeObserver = origRO
  })

  it('fires init empty dispatch and then a non-empty scanner dispatch', async () => {
    const dispatch = vi.fn()
    const state = makeState()

    render(
      <TokensPane
        title="Trending Tokens"
        filters={{ rankBy: 'volume', orderBy: 'desc', minVol24H: 1000, isNotHP: true } as any}
        page={101}
        state={state as any}
        dispatch={dispatch as any}
        defaultSort={{ key: 'tokenName', dir: 'asc' }}
        clientFilters={{ chains: ['ETH', 'SOL', 'BASE', 'BSC'] }}
      />,
    )

    // First, an init empty dispatch should fire
    await waitFor(() => {
      const init = dispatch.mock.calls.find((c) => c?.[0]?.type === 'scanner/pairs')
      expect(init).toBeTruthy()
      expect(init?.[0]?.payload?.page).toBe(101)
      expect(Array.isArray(init?.[0]?.payload?.scannerPairs)).toBe(true)
      expect(init?.[0]?.payload?.scannerPairs.length).toBe(0)
    }, { timeout: 3000 })

    // Log all dispatch calls for debugging
    console.log('Dispatch calls:', dispatch.mock.calls)

    // Then, a non-empty dispatch should occur: either scanner/pairsTokens or scanner/pairs with >0
    await waitFor(() => {
      const pairsTokens = dispatch.mock.calls.find((c) => c?.[0]?.type === 'scanner/pairsTokens')
      const pairs = dispatch.mock.calls
        .filter((c) => c?.[0]?.type === 'scanner/pairs')
        .find((c) => (c?.[0]?.payload?.scannerPairs?.length ?? 0) > 0)
      const ok = !!pairsTokens || !!pairs
      expect(ok).toBe(true)
    }, { timeout: 3000 })
  })
})
