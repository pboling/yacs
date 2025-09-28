import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SortHeader from '../src/components/SortHeader';

describe('SortHeader', () => {
  it('renders without crashing', () => {
    const mockOnSort = () => {};
    const { container } = render(
      <SortHeader
        label="Test"
        k="mcap"
        sortKey="mcap"
        sortDir="desc"
        onSort={mockOnSort}
      />
    );
    expect(container).toBeTruthy();
  });
});
