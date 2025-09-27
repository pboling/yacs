import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    // mark as fresh so it appears in compare options by default
    scannerAt: (partial as any).scannerAt ?? Date.now(),
  } as any
}

describe('DetailModal compare chooser', () => {
  it('selecting a token shows the compare token in the modal', async () => {
    const now = Date.now()
    const base = makeRow({
      id: '1',
      tokenName: 'Alpha',
      tokenSymbol: 'ALPHA',
      chain: 'ETH',
      scannerAt: now,
    })
    const other = makeRow({
      id: '2',
      tokenName: 'Beta',
      tokenSymbol: 'BETA',
      chain: 'ETH',
      scannerAt: now,
    })
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
    const input = screen.getByTestId('compare-input')
    await user.click(input)
    await user.type(input, 'bet')

    // Click on the option with the other token name/symbol
    const list = await screen.findByTestId('compare-options')
    const option = await within(list).findByText(/BETA/i)
    await user.click(option)

    // After selection, the compare chart section title should include Beta (BETA)
    const compareTitle = await screen.findByText(/Beta \(BETA\) – ETH/)
    expect(compareTitle).toBeInTheDocument()

    // Clear button(s) should appear as well (base and compare sections each have one)
    const clearButtons = screen.getAllByRole('button', { name: /Clear/i })
    expect(clearButtons.length).toBeGreaterThan(0)
  })
})
