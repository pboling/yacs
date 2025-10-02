import { describe, it, expect } from 'vitest';
import {
  buildScannerSubscription,
  buildScannerUnsubscription,
  buildPairSubscription,
  buildPairUnsubscription,
  buildPairStatsSubscription,
  buildPairStatsUnsubscription,
  mapIncomingMessageToAction,
} from '../src/ws.mapper.js';

const scannerParams = { chain: 'ETH', page: 1, rankBy: 'volume', orderBy: 'desc' };

describe('subscription builders', () => {
  it('produce expected payloads', () => {
    expect(buildScannerSubscription(scannerParams)).toEqual({
      event: 'scanner-filter',
      data: scannerParams,
    });
    expect(buildScannerUnsubscription(scannerParams)).toEqual({
      event: 'unsubscribe-scanner-filter',
      data: scannerParams,
    });
    const pair = { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' };
    expect(buildPairSubscription(pair)).toEqual({ event: 'subscribe-pair', data: pair });
    expect(buildPairUnsubscription(pair)).toEqual({ event: 'unsubscribe-pair', data: pair });
    expect(buildPairStatsSubscription(pair)).toEqual({ event: 'subscribe-pair-stats', data: pair });
    expect(buildPairStatsUnsubscription(pair)).toEqual({
      event: 'unsubscribe-pair-stats',
      data: pair,
    });
  });
});

describe('mapIncomingMessageToAction', () => {
  it('maps known events and ignores unknown', () => {
    const scannerMsg = {
      event: 'scanner-pairs',
      data: {
        filter: { ...scannerParams, page: 2 },
        results: { pairs: [{ pairAddress: '0xPAIR' }] },
      },
    };
    const a1 = mapIncomingMessageToAction(scannerMsg);
    expect(a1.type).toBe('scanner/ws');
    expect(a1.payload.page).toBe(2);
    const tickMsg = {
      event: 'tick',
      data: { pair: { pair: '0xPAIR', token: '0xTOKEN', chain: 'ETH' }, swaps: [] },
    };
    const a2 = mapIncomingMessageToAction(tickMsg);
    expect(a2.type).toBe('pair/tick');
    const statsMsg = {
      event: 'pair-stats',
      data: { pair: { pairAddress: '0xPAIR' }, pairStats: {}, migrationProgress: '0', callCount: 1 },
    };
    const a3 = mapIncomingMessageToAction(statsMsg);
    expect(a3.type).toBe('pair/stats');
    const wpegMsg = { event: 'wpeg-prices', data: { prices: { ETH: '4183.1100', SOL: '210.5' } } };
    const a4 = mapIncomingMessageToAction(wpegMsg);
    expect(a4).toBeDefined();
    expect(a4.type).toBe('wpeg/prices');
    expect(a4.payload).toEqual({ prices: { ETH: '4183.1100', SOL: '210.5' } });
    const unknown = mapIncomingMessageToAction({ event: 'unknown', data: {} });
    expect(unknown).toBeNull();
  });
});
