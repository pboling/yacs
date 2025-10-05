import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'

interface IMockWebSocket {
  url: string
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onclose: (() => void) | null
  send(data?: any): void
  close(): void
  simulateMessage(data: any): void
}

class MockWebSocket implements IMockWebSocket {
  url: string
  readyState: number
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  constructor(url: string) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) this.onopen()
    }, 10)
  }
  send() {}
  close() {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose()
  }
  simulateMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) })
  }
}

vi.mock('../src/scanner.client.js', () => ({
  fetchScanner: vi.fn().mockResolvedValue({ tokens: [], raw: { scannerPairs: [] } }),
}))

describe('Scanner injection appends rows', () => {
  let mockWs: IMockWebSocket | undefined
  let origWS: typeof global.WebSocket
  let origIO: typeof global.IntersectionObserver

  beforeEach(() => {
    origWS = global.WebSocket
    origIO = global.IntersectionObserver
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }))
    global.WebSocket = vi.fn().mockImplementation((url: string) => {
      mockWs = new MockWebSocket(url)
      return mockWs as unknown as WebSocket
    }) as unknown as typeof WebSocket
    ;(global.WebSocket as any).CONNECTING = MockWebSocket.CONNECTING
    ;(global.WebSocket as any).OPEN = MockWebSocket.OPEN
    ;(global.WebSocket as any).CLOSING = MockWebSocket.CLOSING
    ;(global.WebSocket as any).CLOSED = MockWebSocket.CLOSED
    Object.defineProperty(window, 'requestIdleCallback', { writable: true, value: (fn: () => void) => setTimeout(fn, 0) })
    Object.defineProperty(window, 'localStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() } })
    Object.defineProperty(window, 'sessionStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), clear: vi.fn() } })
    Object.defineProperty(window, '__BYPASS_BOOT__', { writable: true, value: true })
  })
  afterEach(() => {
    global.WebSocket = origWS
    global.IntersectionObserver = origIO
    vi.clearAllMocks()
  })

  it('clicking Faux Scanner REST multiple times accumulates rows (appends, not replace)', async () => {
    render(<App />)

    const restBtn = await screen.findByTestId('inject-scanner-rest')

    // First click → expect some rows in Trending
    await act(async () => {
      fireEvent.click(restBtn)
      await new Promise((r) => setTimeout(r, 300))
    })

    const countEl1 = await screen.findByTestId('rows-count-trending')
    const firstCount = Number(countEl1.textContent || '0')
    expect(firstCount).toBeGreaterThan(0)

    // Second click → expect more rows in Trending (append, not replace)
    await act(async () => {
      fireEvent.click(restBtn)
      await new Promise((r) => setTimeout(r, 300))
    })

    const countEl2 = await screen.findByTestId('rows-count-trending')
    const secondCount = Number(countEl2.textContent || '0')
    expect(secondCount).toBeGreaterThan(firstCount)
  })
})
