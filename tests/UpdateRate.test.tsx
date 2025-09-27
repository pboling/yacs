import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import UpdateRate from '../src/components/UpdateRate'

describe('UpdateRate', () => {
  it('renders without crashing', () => {
    const { container } = render(<UpdateRate rate={1} />);
    expect(container).toBeTruthy();
  });
});

