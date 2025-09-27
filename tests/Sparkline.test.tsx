import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Sparkline from '../src/components/Sparkline'

describe('Sparkline', () => {
  it('renders without crashing', () => {
    const { container } = render(<Sparkline data={[1,2,3]} />);
    expect(container).toBeTruthy();
  });
});

