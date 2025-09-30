import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'

vi.mock('../src/scanner.client.js', () => ({
  fetchScanner: vi.fn().mockResolvedValue({ tokens: [], raw: { scannerPairs: [] } }),
}))

describe('Pair-Stats TopBar counter repeat', () => {
  let origWS: typeof global.WebSocket;
  let origIO: typeof global.IntersectionObserver;

  beforeEach(() => {
    origWS = global.WebSocket;
    origIO = global.IntersectionObserver;
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
    global.WebSocket = vi.fn() as unknown as typeof WebSocket;
    Object.defineProperty(window, 'requestIdleCallback', { writable: true, value: (fn: () => void) => setTimeout(fn, 0) });
    Object.defineProperty(window, 'localStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() } });
    Object.defineProperty(window, 'sessionStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), clear: vi.fn() } });
    Object.defineProperty(window, '__BYPASS_BOOT__', { writable: true, value: true });
  });
  afterEach(() => {
    global.WebSocket = origWS;
    global.IntersectionObserver = origIO;
    vi.clearAllMocks();
  });

  it('increments Pair Stats counter for repeated messages', async () => {
    render(<App />);

    // Seed rows via Faux Scanner REST so pair-stats injection has keys to target
    const restBtn = await screen.findByTestId('inject-scanner-rest')
    await act(async () => {
      fireEvent.click(restBtn)
      await new Promise((r) => setTimeout(r, 250))
    })

    const pairStatsBtn = await screen.findByTitle(/Inject a faux Pair Stats event/)
    const initial = (pairStatsBtn.textContent?.match(/Pair Stats:\s*(\d+)/) || [])[1]
    const initCount = initial ? parseInt(initial, 10) : 0

    await act(async () => {
      fireEvent.click(pairStatsBtn)
      fireEvent.click(pairStatsBtn)
      // Allow eventCounts coalesced flush (~250ms)
      await new Promise((r) => setTimeout(r, 600))
    })

    await waitFor(() => {
      const updated = screen.getByTitle(/Inject a faux Pair Stats event/)
      const num = (updated.textContent?.match(/Pair Stats:\s*(\d+)/) || [])[1]
      expect(parseInt(num || '0', 10)).toBe(initCount + 2)
    }, { timeout: 2000 })
  });
});
