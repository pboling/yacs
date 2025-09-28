/**
 * Test to reproduce the pair-stats counter behavior
 * This test simulates WebSocket pair-stats events and verifies the counter increments
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import App from '../src/App'

// Mock WebSocket to simulate server behavior
class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null

    // Simulate connection opening after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) this.onopen()
    }, 10)
  }

  send(data) {
    // no-op for test; keep lightweight logging available if debugging
    // console.log('[MockWS] Sent:', data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    if (this.onclose) this.onclose()
  }

  // Simulate receiving a message from the server
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) })
    }
  }

  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
}

// Mock the fetchScanner function to return fixture data
vi.mock('../src/scanner.client.js', () => ({
  fetchScanner: vi.fn().mockResolvedValue({
    tokens: [],
    raw: { scannerPairs: [] },
  }),
}))

describe('Pair-Stats Counter', () => {
  let mockWs
  let originalWebSocket
  let originalIntersectionObserver

  beforeEach(() => {
    // Preserve originals
    originalWebSocket = global.WebSocket
    originalIntersectionObserver = global.IntersectionObserver

    // Minimal IntersectionObserver mock used by Table
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    // Replace WebSocket with our mock
    global.WebSocket = vi.fn().mockImplementation((url) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })

    // Provide test-friendly browser APIs used by App
    Object.defineProperty(window, 'requestIdleCallback', {
      writable: true,
      value: (fn) => setTimeout(fn, 0),
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

    // Bypass boot overlay for tests
    Object.defineProperty(window, '__BYPASS_BOOT__', {
      writable: true,
      value: true,
    })
  })

  afterEach(() => {
    // Restore originals
    global.WebSocket = originalWebSocket
    global.IntersectionObserver = originalIntersectionObserver
    vi.clearAllMocks()
  })

  it('should increment counter for pair-stats events', async () => {
    render(<App />)

    // Wait until our MockWebSocket is created and opened
    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    // Wait for the Pair Stats button / label to be present in the top bar
    const pairStatsBtn = await screen.findByText(/Pair Stats:/, {}, { timeout: 3000 })
    expect(pairStatsBtn).toBeDefined()

    // Extract initial numeric value from the label (e.g., 'Pair Stats: 0')
    const initialMatch = pairStatsBtn.textContent?.match(/Pair Stats:\s*(\d+)/)
    const initialCount = initialMatch ? parseInt(initialMatch[1], 10) : 0

    // Build a pair-stats event that matches the App's mapping logic
    const pairStatsEvent = {
      event: 'pair-stats',
      data: {
        pair: {
          pairAddress: '0x1234567890123456789012345678901234567890',
          token1Address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          chain: 'ETH',
        },
        pairStats: {
          volume24h: '1000000',
          liquidity: '5000000',
        },
        migrationProgress: '0',
        callCount: 1,
      },
    }

    // Deliver the message through the mock WS
    await act(async () => {
      mockWs.simulateMessage(pairStatsEvent)
      // allow the message pipeline to settle
      await new Promise((r) => setTimeout(r, 150))
    })

    // Wait for the UI to reflect an incremented counter
    await waitFor(() => {
      const updated = screen.getByText(/Pair Stats:/)
      const m = updated.textContent?.match(/Pair Stats:\s*(\d+)/)
      const count = m ? parseInt(m[1], 10) : NaN
      expect(Number.isFinite(count) ? count : NaN).toBe(initialCount + 1)
    }, { timeout: 3000 })
  })
})
