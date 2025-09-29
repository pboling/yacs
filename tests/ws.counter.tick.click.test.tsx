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

describe('Tick counter click inject', () => {
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
  });
  afterEach(() => {
    global.WebSocket = origWS;
    global.IntersectionObserver = origIO;
    vi.clearAllMocks();
  });

  it('increments Tick counter when clicking Tick button', async () => {
    render(<App />);
    await waitFor(() => {
      expect(mockWs).toBeDefined();
      expect((mockWs as IMockWebSocket).readyState).toBe(MockWebSocket.OPEN);
    }, { timeout: 2000 });

    // Ensure there are visible keys by injecting scanner pairs first
    const scannerBtn = await screen.findByText(/Scanner:/);
    await act(async () => {
      fireEvent.click(scannerBtn);
      // Wait for rows + visible keys to be registered
      await new Promise((r) => setTimeout(r, 350));
    });

    // Find the specific inject button (has title="Inject a faux Tick event")
    const tickBtn = await screen.findByTitle(/Inject a faux Tick event/);
     // Wait until Tick button is enabled (perTokenDisabled may have been true)
     await waitFor(() => expect((tickBtn as HTMLButtonElement).disabled).toBe(false), { timeout: 2000 });

    const initialTick = (tickBtn.textContent?.match(/Tick:\s*(\d+)/) || [])[1];
    const initTickCount = initialTick ? parseInt(initialTick, 10) : 0;

    await act(async () => {
      fireEvent.click(tickBtn);
      // Wait for eventCounts flush
      await new Promise((r) => setTimeout(r, 350));
    });

    const updated = await screen.findByTitle(/Inject a faux Tick event/);
    await waitFor(() => {
      const num = (updated.textContent?.match(/Tick:\s*(\d+)/) || [])[1];
      expect(parseInt(num || '0', 10)).toBe(initTickCount + 1);
    }, { timeout: 2000 });
  });
});
