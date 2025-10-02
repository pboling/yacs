import { describe, it, expect } from 'vitest';
import { buildPairSubscription, buildPairStatsSubscription } from '../src/ws.mapper.js';

const PAIR = '0xPAIR';
const TOKEN = '0xTOKEN';

describe('buildPairSubscription and buildPairStatsSubscription', () => {
  const cases = [
    ['ETH', 'ETH'],
    ['eth', 'ETH'],
    [1, 'ETH'],
    ['1', 'ETH'],
    ['BSC', 'BSC'],
    [56, 'BSC'],
    ['BASE', 'BASE'],
    [8453, 'BASE'],
    ['SOL', 'SOL'],
    [900, 'SOL'],
  ];
  cases.forEach(([input, expected]) => {
    it(`normalizes chain ${String(input)} -> ${expected}`, () => {
      const sub = buildPairSubscription({ pair: PAIR, token: TOKEN, chain: input });
      expect(sub.data.chain).toBe(expected);
      const stats = buildPairStatsSubscription({ pair: PAIR, token: TOKEN, chain: input });
      expect(stats.data.chain).toBe(expected);
    });
  });
});
