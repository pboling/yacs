// Second creation attempt in current session to reproduce prior file-creation failure scenario.
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { computeFilteredCompareOptions, uniqueById } from '../src/utils/filteredCompareOptions.mjs'

// Keep in sync with DetailModalRow shape where needed, but only include fields we assert on
interface Row {
  id: string
  tokenName: string
  tokenSymbol: string
  chain: string
  pairAddress?: string
  tokenAddress?: string
}

function row(partial: Partial<Row> & { id: string }): Row {
  return {
    id: partial.id,
    tokenName: partial.tokenName ?? 'Token ' + partial.id,
    tokenSymbol: partial.tokenSymbol ?? 'SYM' + partial.id,
    chain: partial.chain ?? 'ETH',
    pairAddress: partial.pairAddress,
    tokenAddress: partial.tokenAddress,
  }
}

describe('filteredCompareOptions and uniqueById', () => {
  it('uniqueById keeps the first occurrence and removes subsequent duplicates', () => {
    const a = row({ id: 'dup', tokenName: 'Alpha', tokenSymbol: 'ALP' })
    const b = row({ id: 'dup', tokenName: 'Alpha-Other', tokenSymbol: 'ALPO' })
    const c = row({ id: 'uniq', tokenName: 'Beta', tokenSymbol: 'BET' })

    const out = uniqueById([a, b, c])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'dup', tokenName: 'Alpha', tokenSymbol: 'ALP' })
    expect(out[1]).toMatchObject({ id: 'uniq' })
  })

  it('computeFilteredCompareOptions dedupes across both tables and excludes current row', () => {
    const base = row({ id: 'base', tokenName: 'Base', tokenSymbol: 'BASE' })
    // same token shown twice across two tables (duplicate id)
    const same1 = row({ id: 'x1', tokenName: 'X', tokenSymbol: 'X' })
    const same2 = row({ id: 'x1', tokenName: 'X', tokenSymbol: 'X' })
    const y = row({ id: 'y', tokenName: 'Yankee', tokenSymbol: 'Y' })

    const allRows = [base, same1, same2, y]

    const options = computeFilteredCompareOptions<Row>({
      open: true,
      allRows,
      currentRow: base,
      compareSearch: '',
    })

    // base is excluded
    expect(options.find((o) => o.id === 'base')).toBeUndefined()
    // duplicates collapsed
    const ids = options.map((o) => o.id)
    expect(ids.filter((id) => id === 'x1')).toHaveLength(1)
    // y is present
    expect(ids).toContain('y')
  })

  it('applies case-insensitive search on tokenName or tokenSymbol and caps at 100', () => {
    const base = row({ id: 'base', tokenName: 'Base', tokenSymbol: 'BASE' })
    const rows: Row[] = [base]
    for (let i = 0; i < 200; i++) {
      rows.push(
        row({ id: `i${i}`, tokenName: `Name${i}`, tokenSymbol: i % 2 === 0 ? 'foo' : 'bar' }),
      )
    }

    const optionsFoo = computeFilteredCompareOptions<Row>({
      open: true,
      allRows: rows,
      currentRow: base,
      compareSearch: 'FoO',
    })
    // base excluded + filtered by symbol contains only evens; cap 100
    expect(optionsFoo.length).toBeLessThanOrEqual(100)
    expect(optionsFoo.every((r) => r.tokenSymbol.toLowerCase() === 'foo')).toBe(true)

    const optionsNone = computeFilteredCompareOptions<Row>({
      open: true,
      allRows: rows,
      currentRow: base,
      compareSearch: 'does-not-exist',
    })
    expect(optionsNone).toHaveLength(0)
  })

  it('returns empty list when modal is closed', () => {
    const base = row({ id: 'base' })
    const options = computeFilteredCompareOptions<Row>({
      open: false,
      allRows: [base],
      currentRow: base,
      compareSearch: '',
    })
    expect(options).toEqual([])
  })
})
