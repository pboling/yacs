import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TokensPane from '../src/components/TokensPane';

describe('TokensPane', () => {
  it('renders without crashing', () => {
    const { container } = render(<TokensPane />);
    expect(container).toBeTruthy();
  });
});
