/**
 * Test to reproduce the pair-stats counter behavior
 * This test simulates WebSocket pair-stats events and verifies the counter increments
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'
import { setupObserverMocks } from './helpers/observerMocks'

// Mock WebSocket to simulate server behavior
interface IMockWebSocket {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data?: any): void;
  close(): void;
  simulateMessage(data: any): void;
}

class MockWebSocket implements IMockWebSocket {
  url: string;
  readyState: number;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }

  send() {} // removed unused parameter

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  // Simulate receiving a message from the server
  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
}

// Mock the fetchScanner function to return fixture data
vi.mock('../src/scanner.client.js', () => ({
  // Return a minimal but valid token so the UI renders at least one row
  fetchScanner: vi.fn().mockResolvedValue({
    tokens: [
      {
        id: '0x1234567890123456789012345678901234567890',
        tokenName: 'MockToken',
        tokenSymbol: 'MCK',
        tokenAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        pairAddress: '0x1234567890123456789012345678901234567890',
        chain: 'ETH',
        exchange: 'Uniswap',
        priceUsd: 1,
        mcap: 1000000,
        volumeUsd: 1000,
        priceChangePcs: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
        transactions: { buys: 0, sells: 0 },
        liquidity: { current: 5000, changePc: 0 },
        tokenCreatedTimestamp: new Date(),
        audit: {},
        security: {},
      },
    ],
    raw: { scannerPairs: [] },
  }),
}))

describe('Pair-Stats Counter', () => {
  let mockWs: IMockWebSocket | undefined;
  let originalWebSocket: typeof global.WebSocket;
  let cleanupObservers: (() => void) | undefined;

  // Ensure test lifecycle hooks are available
  beforeEach(() => {
    // Preserve originals
    originalWebSocket = global.WebSocket;

    // Use the shared observer mocks helper
    cleanupObservers = setupObserverMocks();

    // Replace WebSocket with our mock
    global.WebSocket = vi.fn().mockImplementation((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs as unknown as WebSocket;
    }) as unknown as typeof WebSocket;
    (global.WebSocket as any).CONNECTING = MockWebSocket.CONNECTING;
    (global.WebSocket as any).OPEN = MockWebSocket.OPEN;
    (global.WebSocket as any).CLOSING = MockWebSocket.CLOSING;
    (global.WebSocket as any).CLOSED = MockWebSocket.CLOSED;

    // Provide test-friendly browser APIs used by App
    Object.defineProperty(window, 'requestIdleCallback', {
      writable: true,
      value: (fn: () => void) => setTimeout(fn, 0),
    })

    Object.defineProperty(window, 'sessionStorage', {
      writable: true,
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        clear: vi.fn(),
      },
    })

    Object.defineProperty(window, 'localStorage', {
      writable: true,
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      },
    })

    // Mock document.cookie for theme cookie utilities
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
      configurable: true,
    })

    // Bypass boot overlay for tests
    Object.defineProperty(window, '__BYPASS_BOOT__', {
      writable: true,
      value: true,
    })
  })

  afterEach(() => {
    // Restore originals
    global.WebSocket = originalWebSocket
    cleanupObservers?.()
    vi.clearAllMocks()
  })

  it('should increment counter for pair-stats events', async () => {
    render(
        <App />
    );

    // Wait for initial rows to seed from mocked REST fetch (ensures inject has a key to target)
    await waitFor(() => {
      const trending = screen.getByTestId('rows-count-trending') as HTMLElement
      const n = Number(trending.textContent || '0')
      expect(n).toBeGreaterThan(0)
    }, { timeout: 5000 })

    // Locate the Pair Stats faux event button and capture initial count
    const pairStatsBtn = await screen.findByTitle(/Inject a faux Pair Stats event/)
    const initialMatch = pairStatsBtn.textContent?.match(/Pair Stats:\s*(\d+)/)
    const initialCount = initialMatch ? parseInt(initialMatch[1], 10) : 0

    await act(async () => {
      fireEvent.click(pairStatsBtn)
      // Allow eventCounts flush (coalesced ~250ms)
      await new Promise((r) => setTimeout(r, 600))
    })

    const updated = await screen.findByTitle(/Inject a faux Pair Stats event/)
    await waitFor(() => {
      const m = updated.textContent?.match(/Pair Stats:\s*(\d+)/)
      const count = m ? parseInt(m[1], 10) : NaN
      expect(count).toBe(initialCount + 1)
    }, { timeout: 3000 })
  })
})
