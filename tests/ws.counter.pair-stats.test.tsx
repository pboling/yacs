/**
 * Test to reproduce the tick counter issue
 * This test simulates WebSocket tick events and verifies the counter increments
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
    console.log('[MockWS] Sent:', data)
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
    raw: { scannerPairs: [] }
  })
}))

describe('Tick Counter Bug Reproduction', () => {
  let mockWs
  let originalWebSocket
  let originalIntersectionObserver

  beforeEach(() => {
    // Store original WebSocket and IntersectionObserver
    originalWebSocket = global.WebSocket
    originalIntersectionObserver = global.IntersectionObserver

    // Mock IntersectionObserver for tests
    global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))

    // Replace WebSocket with our mock
    global.WebSocket = vi.fn().mockImplementation((url) => {
      mockWs = new MockWebSocket(url)
      return mockWs
    })

    // Mock window properties that App.tsx expects
    Object.defineProperty(window, 'requestIdleCallback', {
      writable: true,
      value: (fn) => setTimeout(fn, 0)
    })

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      writable: true,
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        clear: vi.fn(),
      }
    })

    // Mock localStorage for the app
    Object.defineProperty(window, 'localStorage', {
      writable: true,
      value: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      }
    })

    // Bypass the boot overlay for testing
    Object.defineProperty(window, '__BYPASS_BOOT__', {
      writable: true,
      value: true
    })
  })

  afterEach(() => {
    // Restore original WebSocket and IntersectionObserver
    global.WebSocket = originalWebSocket
    global.IntersectionObserver = originalIntersectionObserver
    vi.clearAllMocks()
  })

  it('should increment counter for pair-stats events', async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    // Find the pair-stats counter
    const pairStatsCounter = await screen.findByText(/Pair Stats:/)
    expect(pairStatsCounter.textContent).toContain('0')

    // Send a valid pair-stats event
    const pairStatsEvent = {
      event: 'pair-stats',
      data: {
        pair: {
          pairAddress: '0x1234567890123456789012345678901234567890',
          token1Address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          chain: 'ETH'
        },
        pairStats: {
          volume24h: '1000000',
          liquidity: '5000000'
        },
        migrationProgress: '0',
        callCount: 1
      }
    }

    await act(async () => {
      mockWs.simulateMessage(pairStatsEvent)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Wait for the counter to update
    await waitFor(() => {
      const updatedCounter = screen.getByText(/Pair Stats:/)
      expect(updatedCounter.textContent).toMatch(/Pair Stats:\s*1/)
    }, { timeout: 3000 })

    console.log('✓ Pair Stats counter successfully incremented')
  })
})
