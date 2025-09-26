import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFilteredCompareOptions } from '../src/utils/filteredCompareOptions.mjs'

const makeRow = (id, name, symbol) => ({ id, tokenName: name, tokenSymbol: symbol })

const rows = [
  makeRow('1', 'Alpha Token', 'ALPHA'),
  makeRow('2', 'Beta Coin', 'BETA'),
  makeRow('3', 'Gamma Asset', 'GAMMA'),
]

test('returns empty when not open', () => {
  const res = computeFilteredCompareOptions({
    open: false,
    allRows: rows,
    currentRow: rows[0],
    compareSearch: '',
  })
  assert.equal(res.length, 0)
})

test('excludes current row by id', () => {
  const res = computeFilteredCompareOptions({
    open: true,
    allRows: rows,
    currentRow: rows[1],
    compareSearch: '',
  })
  assert.equal(res.length, 2)
  assert.ok(res.every((r) => r.id !== '2'))
})

test('caps to top 100 when no search', () => {
  const many = Array.from({ length: 150 }, (_, i) => makeRow(String(i), `Name${i}`, `SYM${i}`))
  const res = computeFilteredCompareOptions({
    open: true,
    allRows: many,
    currentRow: null,
    compareSearch: '',
  })
  assert.equal(res.length, 100)
})

test('filters by tokenName or tokenSymbol (case-insensitive)', () => {
  const res1 = computeFilteredCompareOptions({
    open: true,
    allRows: rows,
    currentRow: null,
    compareSearch: 'beta',
  })
  assert.equal(res1.length, 1)
  assert.equal(res1[0].id, '2')

  const res2 = computeFilteredCompareOptions({
    open: true,
    allRows: rows,
    currentRow: null,
    compareSearch: 'GAM',
  })
  assert.equal(res2.length, 1)
  assert.equal(res2[0].id, '3')
})
