import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Row from '../src/components/Row'

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
    priceChangePcs: { '5m': 0.1, '1h': 0.2, '6h': 0.3, '24h': 0.4 },
    transactions: { buys: 1, sells: 2 },
    liquidity: { current: 5000, changePc: 0.5 },
    tokenCreatedTimestamp: new Date(),
  }
}

describe('Row smoke: renders key bits', () => {
  it('renders token name/symbol and exchange', async () => {
    const t = makeRow('row-1', 'Alpha', 'ALPHA')
    render(
      <table>
        <tbody>
          <Row
            row={t as any}
            idx={0}
            rowsLen={1}
            composedId={`${t.id}::TREND`}
            registerRow={() => {}}
          />
        </tbody>
      </table>,
    )

    // token name or symbol should be visible somewhere in cells
    const nameLike = await screen.findByText(/Alpha|ALPHA/i)
    expect(nameLike).toBeInTheDocument()

    // exchange is rendered as an icon with a title attribute; assert by title
    const exch = await screen.findByTitle(/uni/i)
    expect(exch).toBeInTheDocument()
  })
})
