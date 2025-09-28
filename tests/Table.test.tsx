import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import Table from '../src/components/Table';
import type { Token } from '../src/models/Token';

const mockToken: Token = {
  id: 'test-token-1',
  tokenName: 'Test Token',
  tokenSymbol: 'TEST',
  chain: 'ETH',
  exchange: 'uniswap',
  priceUsd: 1.23,
  mcap: 1000000,
  volumeUsd: 50000,
  priceChangePcs: { '5m': 0.5, '1h': 1.2, '6h': -0.8, '24h': 2.1 },
  tokenCreatedTimestamp: new Date(),
  transactions: { buys: 10, sells: 5 },
  liquidity: { current: 500000, changePc: 1.5 },
  pairAddress: '0x123',
  tokenAddress: '0x456',
  audit: {},
  security: {},
};

beforeAll(() => {
  global.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('Table', () => {
  it('renders without crashing', () => {
    const mockOnSort = () => {};
    const { container } = render(
      <Table
        title="Test Table"
        rows={[mockToken]}
        loading={false}
        error={null}
        onSort={mockOnSort}
        sortKey="mcap"
        sortDir="desc"
      />
    );
    expect(container).toBeTruthy();
  });
});
