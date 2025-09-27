import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NumberCell from '../src/components/NumberCell';

describe('NumberCell', () => {
  it('renders without crashing', () => {
    const { container } = render(<NumberCell value={123} />);
    expect(container).toBeTruthy();
  });
});

