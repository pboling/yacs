import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import WsConsole from '../src/components/WsConsole';
import Table from '../src/components/Table';

describe('WsConsole', () => {
  it('renders without crashing', () => {
    const { container } = render(<WsConsole />);
    expect(container).toBeTruthy();
  });
});

describe('Table', () => {
  it('renders without crashing', () => {
    const { container } = render(<Table rows={[]} />);
    expect(container).toBeTruthy();
  });
});
