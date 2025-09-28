import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AuditIcons from '../src/components/AuditIcons';
import type { AuditFlags } from '../src/components/AuditIcons';

describe('AuditIcons', () => {
  it('renders without crashing', () => {
    const flags: AuditFlags = {
      verified: true,
      freezable: false,
      renounced: true,
      locked: false,
      honeypot: false,
    };
    const { container } = render(<AuditIcons flags={flags} />);
    expect(container).toBeTruthy();
  });
});
