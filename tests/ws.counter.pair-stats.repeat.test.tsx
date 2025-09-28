import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'

// Minimal MockWebSocket reused pattern
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onclose = null
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
  simulateMessage(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) })
  }
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
}

vi.mock('../src/scanner.client.js', () => ({
  fetchScanner: vi.fn().mockResolvedValue({ tokens: [], raw: { scannerPairs: [] } }),
}))

describe('Pair-Stats TopBar counter repeat', () => {
  let mockWs
  let origWS
  let origIO

  beforeEach(() => {
    origWS = global.WebSocket
    origIO = global.IntersectionObserver
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }))
    global.WebSocket = vi.fn().mockImplementation((url) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })
    Object.defineProperty(window, 'requestIdleCallback', { writable: true, value: (fn) => setTimeout(fn, 0) })
    Object.defineProperty(window, 'localStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() } })
    Object.defineProperty(window, 'sessionStorage', { writable: true, value: { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), clear: vi.fn() } })
    Object.defineProperty(window, '__BYPASS_BOOT__', { writable: true, value: true })
  })
  afterEach(() => {
    global.WebSocket = origWS
    global.IntersectionObserver = origIO
    vi.clearAllMocks()
  })

  it('increments Pair Stats counter for repeated messages', async () => {
    render(<App />)
    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 2000 })

    const btn = await screen.findByText(/Pair Stats:/)
    const initial = (btn.textContent?.match(/Pair Stats:\s*(\d+)/) || [])[1]
    const initCount = initial ? parseInt(initial, 10) : 0

    const ev = { event: 'pair-stats', data: { pair: { pairAddress: '0x1', token1Address: '0x1', chain: 'ETH' }, pairStats: {}, migrationProgress: '0' } }

    await act(async () => {
      mockWs.simulateMessage(ev)
      mockWs.simulateMessage(ev)
      await new Promise((r) => setTimeout(r, 150))
    })

    await waitFor(() => {
      const updated = screen.getByText(/Pair Stats:/)
      const num = (updated.textContent?.match(/Pair Stats:\s*(\d+)/) || [])[1]
      expect(parseInt(num || '0', 10)).toBe(initCount + 2)
    }, { timeout: 2000 })
  })
})

