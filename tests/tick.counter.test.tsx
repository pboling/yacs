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

  it('should increment tick counter when receiving tick events', async () => {
    // Render the App component
    const { container } = render(<App />)

    // Wait for the component to mount and WebSocket to be established
    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    // Look for the tick counter in the TopBar
    await waitFor(() => {
      const tickElement = screen.getByText(/Tick:/)
      expect(tickElement).toBeInTheDocument()
    }, { timeout: 5000 })

    const tickCounter = screen.getByText(/Tick:/)
    console.log('Initial tick counter text:', tickCounter.textContent)

    // The counter should initially be 0
    expect(tickCounter.textContent).toContain('0')

    // Create a valid tick event
    const validTickEvent = {
      event: 'tick',
      data: {
        pair: {
          pair: '0x1234567890123456789012345678901234567890',
          token: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          chain: 'ETH'
        },
        swaps: [
          {
            timestamp: Date.now(),
            amount0In: '1000000000000000000',
            amount1Out: '2500000000000000000000',
            priceUsd: 2500
          }
        ]
      }
    }

    // Send the tick event through our mock WebSocket
    await act(async () => {
      mockWs.simulateMessage(validTickEvent)
      // Wait for the message to be processed
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Wait for the counter to update
    await waitFor(() => {
      const updatedCounter = screen.getByText(/Tick:/)
      expect(updatedCounter.textContent).toMatch(/Tick:\s*1/)
    }, { timeout: 3000 })

    console.log('✓ Tick counter successfully incremented')
  })

  it('should not increment counter for malformed tick events', async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    // Wait for initial counter to be rendered and get its initial value
    const tickCounter = await screen.findByText(/Tick:/)
    const initialCountMatch = tickCounter.textContent?.match(/Tick:\s*(\d+)/)
    const initialCount = initialCountMatch ? parseInt(initialCountMatch[1]) : 0

    // Send a malformed tick event (missing required pair object)
    const malformedTickEvent = {
      event: 'tick',
      data: {
        // Missing pair object - this should fail validation
        swaps: [{ timestamp: Date.now() }]
      }
    }

    await act(async () => {
      mockWs.simulateMessage(malformedTickEvent)
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Wait a bit and verify counter didn't increment (should still be same as initial)
    await new Promise(resolve => setTimeout(resolve, 500))

    const unchangedCounter = screen.getByText(/Tick:/)
    const finalCountMatch = unchangedCounter.textContent?.match(/Tick:\s*(\d+)/)
    const finalCount = finalCountMatch ? parseInt(finalCountMatch[1]) : 0

    // Counter should not have incremented from its initial value
    expect(finalCount).toBe(initialCount)

    console.log('✓ Malformed tick event correctly ignored')
  })

  it('should increment counter for pair-stats events (control test)', async () => {
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

  it('should handle multiple event types correctly', async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    // Wait for all counters to be rendered
    await waitFor(() => {
      expect(screen.getByText(/Tick:/)).toBeInTheDocument()
      expect(screen.getByText(/Pair Stats:/)).toBeInTheDocument()
      expect(screen.getByText(/Scanner:/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Send multiple different events
    await act(async () => {
      // Send tick event
      mockWs.simulateMessage({
        event: 'tick',
        data: {
          pair: { pair: '0x1234', token: '0xabcd', chain: 'ETH' },
          swaps: [{ timestamp: Date.now(), priceUsd: 2500 }]
        }
      })

      // Send pair-stats event
      mockWs.simulateMessage({
        event: 'pair-stats',
        data: {
          pair: { pairAddress: '0x1234', chain: 'ETH' },
          pairStats: {},
          migrationProgress: '0',
          callCount: 1
        }
      })

      // Send scanner-pairs event
      mockWs.simulateMessage({
        event: 'scanner-pairs',
        data: {
          pairs: [{ pairAddress: '0x1234' }]
        }
      })

      await new Promise(resolve => setTimeout(resolve, 200))
    })

    // Verify all counters increment
    await waitFor(() => {
      expect(screen.getByText(/Tick:\s*1/)).toBeInTheDocument()
      expect(screen.getByText(/Pair Stats:\s*1/)).toBeInTheDocument()
      expect(screen.getByText(/Scanner:\s*1/)).toBeInTheDocument()
    }, { timeout: 3000 })

    console.log('✓ All event counters successfully incremented')
  })

  it('should handle rapid tick events without losing count', async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(mockWs).toBeDefined()
      expect(mockWs.readyState).toBe(MockWebSocket.OPEN)
    }, { timeout: 3000 })

    const tickCounter = await screen.findByText(/Tick:/)
    expect(tickCounter.textContent).toContain('0')

    const createTickEvent = (id) => ({
      event: 'tick',
      data: {
        pair: {
          pair: `0x${id.toString().padStart(40, '0')}`,
          token: `0x${id.toString().padStart(40, 'a')}`,
          chain: 'ETH'
        },
        swaps: [{ timestamp: Date.now() + id, priceUsd: 2500 + id }]
      }
    })

    // Send multiple tick events rapidly
    await act(async () => {
      for (let i = 1; i <= 5; i++) {
        mockWs.simulateMessage(createTickEvent(i))
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    })

    // Verify counter shows the correct total count
    await waitFor(() => {
      const updatedCounter = screen.getByText(/Tick:/)
      expect(updatedCounter.textContent).toMatch(/Tick:\s*5/)
    }, { timeout: 3000 })

    console.log('✓ Rapid tick events correctly counted')
  })
})
