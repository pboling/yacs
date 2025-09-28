import { describe, it, expect } from 'vitest';

describe('Minimal JSX Test', () => {
  it('renders JSX', () => {
    const element = <div>Hello JSX</div>;
    expect(element).toBeTruthy();
  });
});
