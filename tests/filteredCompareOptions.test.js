import { describe, it, expect } from 'vitest';
import { computeFilteredCompareOptions } from '../src/utils/filteredCompareOptions.mjs';

const makeRow = (id, name, symbol) => ({ id, tokenName: name, tokenSymbol: symbol });
const rows = [
  makeRow('1', 'Alpha Token', 'ALPHA'),
  makeRow('2', 'Beta Coin', 'BETA'),
  makeRow('3', 'Gamma Asset', 'GAMMA'),
];

describe('computeFilteredCompareOptions', () => {
  it('returns empty when not open', () => {
    const res = computeFilteredCompareOptions({
      open: false,
      allRows: rows,
      currentRow: rows[0],
      compareSearch: '',
    });
    expect(res.length).toBe(0);
  });

  it('excludes current row by id', () => {
    const res = computeFilteredCompareOptions({
      open: true,
      allRows: rows,
      currentRow: rows[1],
      compareSearch: '',
      includeStale: true,
      includeDegraded: true,
    });
    expect(res.length).toBe(2);
    expect(res.every((r) => r.id !== '2')).toBe(true);
  });

  it('caps to top 100 when no search', () => {
    const many = Array.from({ length: 150 }, (_, i) => makeRow(String(i), `Name${i}`, `SYM${i}`));
    const res = computeFilteredCompareOptions({
      open: true,
      allRows: many,
      currentRow: null,
      compareSearch: '',
      includeStale: true,
      includeDegraded: true,
    });
    expect(res.length).toBe(100);
  });

  it('filters by tokenName or tokenSymbol (case-insensitive)', () => {
    const res1 = computeFilteredCompareOptions({
      open: true,
      allRows: rows,
      currentRow: null,
      compareSearch: 'beta',
      includeStale: true,
      includeDegraded: true,
    });
    expect(res1.length).toBe(1);
    expect(res1[0].id).toBe('2');

    const res2 = computeFilteredCompareOptions({
      open: true,
      allRows: rows,
      currentRow: null,
      compareSearch: 'GAM',
      includeStale: true,
      includeDegraded: true,
    });
    expect(res2.length).toBe(1);
    expect(res2[0].id).toBe('3');
  });
});
