import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TokensPane from '../src/components/TokensPane';

const mockFilters = {
  chain: 'ETH',
  exchange: 'uniswap',
  minVolume: 1000,
  maxAge: 24
};

const mockState = {
  byId: {},
  pages: {}
};

const mockDispatch = () => {};

describe('TokensPane', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <TokensPane
        title="Test Pane"
        filters={mockFilters}
        page={1}
        state={mockState}
        dispatch={mockDispatch}
        defaultSort={{ key: 'mcap', dir: 'desc' }}
      />
    );
    expect(container).toBeTruthy();
  });
});
