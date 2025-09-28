import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AuditIcons, { AuditFlags } from '../src/components/AuditIcons';

describe('AuditIcons', () => {
  it('renders without crashing', () => {
    const flags: AuditFlags = { verified: true };
    const { container } = render(<AuditIcons {...flags} />);
    expect(container).toBeTruthy();
  });
});
