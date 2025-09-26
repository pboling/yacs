import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetailModal, { type DetailModalRow } from '../src/components/DetailModal'

function makeRow(partial: Partial<DetailModalRow> & { id: string }): DetailModalRow {
  return {
    id: partial.id,
    tokenName: partial.tokenName ?? 'Base Token',
    tokenSymbol: partial.tokenSymbol ?? 'BASE',
    chain: partial.chain ?? 'ETH',
    exchange: partial.exchange ?? 'Uniswap',
    priceUsd: partial.priceUsd ?? 1,
    mcap: partial.mcap ?? 1000,
    volumeUsd: partial.volumeUsd ?? 10,
    priceChangePcs: partial.priceChangePcs ?? { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
    tokenCreatedTimestamp: partial.tokenCreatedTimestamp ?? new Date(),
    transactions: partial.transactions ?? { buys: 0, sells: 0 },
    liquidity: partial.liquidity ?? { current: 0, changePc: 0 },
    tokenAddress: partial.tokenAddress,
    pairAddress: partial.pairAddress,
    totalSupply: partial.totalSupply,
    burnedSupply: partial.burnedSupply,
    percentBurned: partial.percentBurned,
    deadAddress: partial.deadAddress,
    ownerAddress: partial.ownerAddress,
    audit: partial.audit,
    security: partial.security,
  }
}

describe('DetailModal compare chooser', () => {
  it('selecting a token shows the compare token in the modal', async () => {
    const base = makeRow({ id: '1', tokenName: 'Alpha', tokenSymbol: 'ALPHA', chain: 'ETH' })
    const other = makeRow({ id: '2', tokenName: 'Beta', tokenSymbol: 'BETA', chain: 'ETH' })
    const allRows = [base, other]

    const user = userEvent.setup()

    render(
      <DetailModal
        open={true}
        row={base}
        currentRow={base}
        onClose={() => {}}
        getRowById={(id) => allRows.find((r) => r.id === id)}
        allRows={allRows}
      />,
    )

    // Focus the compare input to open the list
    const input = screen.getByPlaceholderText('Search token name or symbol')
    await user.click(input)

    // Click on the option with the other token name/symbol
    const option = await screen.findByText(/BETA/i)
    await user.click(option)

    // After selection, the compare chart section title should include Beta (BETA)
    const compareTitle = await screen.findByText(/Beta \(BETA\) – ETH/)
    expect(compareTitle).toBeInTheDocument()

    // Clear button should appear as well
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument()
  })
})
