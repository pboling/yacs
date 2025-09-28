import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Table from '../src/components/Table'

// Minimal Token type used by Table/Row
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

function makeRow(id: string, name = 'Alpha', sym = 'ALPHA'): TokenRow {
  return {
    id,
    tokenName: name,
    tokenSymbol: sym,
    chain: 'ETH',
    exchange: 'Uniswap',
    priceUsd: 1.23,
    mcap: 123456,
    volumeUsd: 1000,
    priceChangePcs: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
    transactions: { buys: 1, sells: 2 },
    liquidity: { current: 5000, changePc: 0 },
    tokenCreatedTimestamp: new Date(),
  }
}

// Light-weight environment stubs used by Table's observers
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('Table smoke: renders rows and canary', () => {
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

  it('renders provided rows and updates rows-count canary', async () => {
    const rows: TokenRow[] = [makeRow('1', 'Alpha', 'ALPHA'), makeRow('2', 'Beta', 'BETA')]

    render(
      <Table
        title="Trending Tokens"
        rows={rows as any}
        loading={false}
        error={null}
        onSort={() => {}}
        sortKey="tokenName"
        sortDir="asc"
        onRowVisibilityChange={() => {}}
        onBothEndsVisible={() => {}}
        onContainerRef={() => {}}
      />,
    )

    // Canary shows total > 0
    const canary = await screen.findByTestId('rows-count-trending')
    expect(canary).toBeInTheDocument()
    expect(canary.textContent || '').toMatch(/\b(1|2)\b/)

    // Table body contains two data rows
    const body = canary.closest('table')?.querySelector('tbody')
    const trs = Array.from(body?.querySelectorAll('tr') || [])
    expect(trs.length).toBeGreaterThan(0)
  })
})
