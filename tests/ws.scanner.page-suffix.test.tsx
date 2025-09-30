import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'

interface IMockWebSocket {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
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
  onclose: (() => void) | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 10);
  }
  send() {}
  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }
  simulateMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
}

vi.mock('../src/scanner.client.js', () => ({
  fetchScanner: vi.fn().mockResolvedValue({ tokens: [], raw: { scannerPairs: [] } }),
}))

describe('Scanner page suffix injection', () => {
  let mockWs: IMockWebSocket | undefined;
  let origWS: typeof global.WebSocket;
  let origIO: typeof global.IntersectionObserver;

  beforeEach(() => {
    origWS = global.WebSocket;
    origIO = global.IntersectionObserver;
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }));
    global.WebSocket = vi.fn().mockImplementation((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs as unknown as WebSocket;
    }) as unknown as typeof WebSocket;
    (global.WebSocket as any).CONNECTING = MockWebSocket.CONNECTING;
    (global.WebSocket as any).OPEN = MockWebSocket.OPEN;
    (global.WebSocket as any).CLOSING = MockWebSocket.CLOSING;
    (global.WebSocket as any).CLOSED = MockWebSocket.CLOSED;
    Object.defineProperty(window, 'requestIdleCallback', { writable: true, value: (fn: () => void) => setTimeout(fn, 0) });
    Object.defineProperty(window, 'localStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() } });
    Object.defineProperty(window, 'sessionStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), clear: vi.fn() } });
    Object.defineProperty(window, '__BYPASS_BOOT__', { writable: true, value: true });
    // Initialize REST page map to page 1 for both panes (legacy helper; app manages its own counter)
    ;(window as any).__REST_PAGES__ = { 101: 1, 201: 1 };
  });
  afterEach(() => {
    global.WebSocket = origWS;
    global.IntersectionObserver = origIO;
    vi.clearAllMocks();
  });

  it('injects Faux rows with -p<page> suffix based on pane REST page (starts at p1, then p2)', async () => {
    // Disable virtualization so all rows render in DOM (for reliable selectors)
    try {
      window.history.replaceState(null, '', '?virtual=false')
    } catch {}

    const { container } = render(<App />);

    // Use the Faux Scanner REST control that appends pages for both panes
    const restBtn = await screen.findByTestId('inject-scanner-rest');

    // First click should produce -p1 rows for Trending
    await act(async () => {
      fireEvent.click(restBtn);
    });

    // Wait until Trending has some rows and -p1 appears
    await waitFor(() => {
      const countEl = screen.getByTestId('rows-count-trending') as HTMLElement;
      const n = Number(countEl.textContent || '0');
      expect(n).toBeGreaterThan(0);
    }, { timeout: 5000 });
    await waitFor(() => {
      const rowsP1 = container.querySelectorAll('tr[data-row-id*="-p1::TREND"]');
      expect(rowsP1.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    // Second click should advance to -p2 rows
    await act(async () => {
      fireEvent.click(restBtn);
    });

    await waitFor(() => {
      const countEl = screen.getByTestId('rows-count-trending') as HTMLElement;
      const n = Number(countEl.textContent || '0');
      expect(n).toBeGreaterThan(50);
    }, { timeout: 8000 });
    await waitFor(() => {
      const rowsP2 = container.querySelectorAll('tr[data-row-id*="-p2::TREND"]');
      expect(rowsP2.length).toBeGreaterThan(0);
    }, { timeout: 8000 });
  }, 15000);
});
