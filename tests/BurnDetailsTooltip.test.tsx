import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BurnDetailsTooltip } from '../src/components/BurnDetailsTooltip';

describe('BurnDetailsTooltip', () => {
  it('renders without crashing', () => {
    const { container } = render(<BurnDetailsTooltip totalSupply={1000} burnedSupply={100} percentBurned={10} />);
    expect(container).toBeTruthy();
  });
});
