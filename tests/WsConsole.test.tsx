import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WsConsole from '../src/components/WsConsole';

describe('WsConsole', () => {
  it('renders without crashing', () => {
    const { container } = render(<WsConsole />);
    expect(container).toBeTruthy();
  });
});
