import { describe, it, expect } from 'vitest';
import { generateScannerResponse } from '../src/scanner.endpoint.js';

function isIsoDate(s) {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s));
}

function hasScannerFields(item) {
  const requiredStringFields = [
    'bundlerHoldings',
    'currentMcap',
    'devHoldings',
    'diff1H',
    'diff24H',
    'diff5M',
    'diff6H',
    'fdv',
    'first1H',
    'first24H',
    'first5M',
    'first6H',
    'initialMcap',
    'insiderHoldings',
    'liquidity',
    'liquidityLockedAmount',
    'liquidityLockedRatio',
    'pairMcapUsd',
    'pairMcapUsdInitial',
    'percentChangeInLiquidity',
    'percentChangeInMcap',
    'price',
    'reserves0',
    'reserves0Usd',
    'reserves1',
    'reserves1Usd',
    'sniperHoldings',
    'top10Holdings',
    'volume',
    'token1TotalSupplyFormatted',
  ];
  for (const f of requiredStringFields) {
    if (typeof item[f] !== 'string') return false;
  }
  if (typeof item.callCount !== 'number') return false;
  if (typeof item.chainId !== 'number') return false;
  if (typeof item.contractRenounced !== 'boolean') return false;
  if (typeof item.contractVerified !== 'boolean') return false;
  if (typeof item.dexPaid !== 'boolean') return false;
  if (typeof item.insiders !== 'number') return false;
  if (typeof item.liquidityLocked !== 'boolean') return false;
  if (typeof item.snipers !== 'number') return false;
  if (typeof item.token0Decimals !== 'number') return false;
  if (typeof item.token0Symbol !== 'string') return false;
  if (typeof item.token1Address !== 'string') return false;
  if (typeof item.token1Decimals !== 'string') return false;
  if (
    typeof item.token1ImageUri !== 'string' &&
    item.token1ImageUri !== null &&
    item.token1ImageUri !== undefined
  )
    return false;
  if (typeof item.token1Name !== 'string') return false;
  if (typeof item.token1Symbol !== 'string') return false;
  if (typeof item.pairAddress !== 'string') return false;
  if (typeof item.routerAddress !== 'string') return false;
  if (!isIsoDate(item.age)) return false;
  return true;
}

describe('generateScannerResponse', () => {
  it('should generate valid scanner response', () => {
    const res = generateScannerResponse({ chain: 'ETH', rankBy: 'volume', page: 1, isNotHP: true });
    expect(typeof res).toBe('object');
    expect(res.page).toBe(1);
    expect(typeof res.totalPages).toBe('number');
    expect(Array.isArray(res.scannerPairs)).toBe(true);
    expect(res.scannerPairs.length).toBeGreaterThan(0);
    expect(hasScannerFields(res.scannerPairs[0])).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const r1 = generateScannerResponse({ chain: 'ETH', rankBy: 'volume', page: 1 });
    const r2 = generateScannerResponse({ chain: 'ETH', rankBy: 'volume', page: 1 });
    expect(r1.scannerPairs[0].pairAddress).toBe(r2.scannerPairs[0].pairAddress);
    expect(r1.scannerPairs.length).toBe(r2.scannerPairs.length);
  });

  it('changes with page parameter', () => {
    const r1 = generateScannerResponse({ chain: 'ETH', page: 1 });
    const r2 = generateScannerResponse({ chain: 'ETH', page: 2 });
    expect(r1.scannerPairs[0].pairAddress).not.toBe(r2.scannerPairs[0].pairAddress);
  });

  it('include market cap candidates with at least one > 0', () => {
    const res = generateScannerResponse({ chain: 'SOL', page: 1 });
    const s = res.scannerPairs[0];
    const vals = [s.currentMcap, s.initialMcap, s.pairMcapUsd, s.pairMcapUsdInitial].map(parseFloat);
    expect(vals.some((v) => v > 0)).toBe(true);
  });
});
