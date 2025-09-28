import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SortHeader from '../src/components/SortHeader';

describe('SortHeader', () => {
  it('renders without crashing', () => {
    const { container } = render(<SortHeader label="Test" />);
    expect(container).toBeTruthy();
  });
});
