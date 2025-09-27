import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChartSection } from '../src/components/ChartSection';

describe('ChartSection', () => {
  it('renders without crashing', () => {
    const props = {
      title: 'Test Chart',
      history: { price: [1, 2, 3] },
      palette: { price: '#000' },
      selectedMetric: 'price',
      seriesKeys: ['price'],
      seriesLabels: { price: 'Price' },
      focusOrder: ['price'],
      symbol: 'TST',
      buildPath: () => '',
    };
    const { container } = render(<ChartSection {...props} />);
    expect(container).toBeTruthy();
  });
});
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

