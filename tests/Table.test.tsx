import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Table from '../src/components/Table';

describe('Table', () => {
  it('renders without crashing', () => {
    const { container } = render(<Table rows={[]} />);
    expect(container).toBeTruthy();
  });
});
