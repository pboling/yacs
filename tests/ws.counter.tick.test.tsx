/**
 * Test to reproduce the tick counter behavior
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

describe('Tick Counter', () => {
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
})
