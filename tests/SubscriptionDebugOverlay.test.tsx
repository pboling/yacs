import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SubscriptionDebugOverlay from '../src/components/SubscriptionDebugOverlay';

describe('SubscriptionDebugOverlay', () => {
  it('renders without crashing', () => {
    const { container } = render(<SubscriptionDebugOverlay />);
    expect(container).toBeTruthy();
  });
});
