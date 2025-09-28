import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Row from '../src/components/Row';

describe('Row', () => {
  it('renders without crashing', () => {
    const { container } = render(<Row id="test" />);
    expect(container).toBeTruthy();
  });
});
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ErrorBoundary from '../src/components/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('renders without crashing', () => {
    const { container } = render(<ErrorBoundary><div>Child</div></ErrorBoundary>);
    expect(container).toBeTruthy();
  });
});
