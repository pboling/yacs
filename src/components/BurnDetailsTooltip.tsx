import React from 'react';

export interface BurnDetailsTooltipProps {
  totalSupply?: number;
  burnedSupply?: number;
  percentBurned?: number;
  deadAddress?: string;
  ownerAddress?: string;
  burnedStatus?: boolean | null;
}

function safeNumberFormat(val: unknown, digits = 0) {
  return typeof val === 'number' && Number.isFinite(val)
    ? digits > 0
      ? val.toFixed(digits)
      : val.toLocaleString()
    : '—';
}

export const BurnDetailsTooltip: React.FC<BurnDetailsTooltipProps> = ({
  totalSupply,
  burnedSupply,
  percentBurned,
  deadAddress,
  ownerAddress,
  burnedStatus,
}) => (
  <div style={{ minWidth: 320, maxWidth: 480, padding: 18, background: 'rgba(17,24,39,0.98)', color: '#fff', border: '1px solid #374151', borderRadius: 8, fontSize: 15, boxShadow: '0 4px 32px #0008' }}>
    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 18 }}>Burn Details</div>
    <div style={{ fontSize: 15, lineHeight: 1.7 }}>
      <div><span className="muted">Total Supply:</span> {safeNumberFormat(totalSupply)}</div>
      <div><span className="muted">Burned Supply:</span> {safeNumberFormat(burnedSupply)}</div>
      <div><span className="muted">Percent Burned:</span> {typeof percentBurned === 'number' && Number.isFinite(percentBurned) ? `${safeNumberFormat(percentBurned, 2)}%` : '—'}</div>
      <div><span className="muted">Dead Address:</span> <span style={{ fontFamily: 'monospace' }}>{typeof deadAddress === 'string' ? deadAddress : '—'}</span></div>
      <div><span className="muted">Owner Address:</span> <span style={{ fontFamily: 'monospace' }}>{typeof ownerAddress === 'string' ? ownerAddress : '—'}</span></div>
      <div><span className="muted">Burned Status:</span> {burnedStatus === true ? 'Burned' : burnedStatus === false ? 'Not Burned' : 'Unknown'}</div>
    </div>
  </div>
);

