/**
 * WebSocket utility functions for readiness checks and common patterns
 */

/**
 * Check if a WebSocket connection is ready (OPEN state)
 * @param ws - WebSocket instance or null/undefined
 * @returns true if WebSocket is connected and ready
 */
export function isWebSocketReady(ws: WebSocket | null | undefined): boolean {
  if (!ws) return false

  try {
    // Check for OPEN state (readyState === 1)
    return ws.readyState === 1 || ws.readyState === WebSocket.OPEN
  } catch {
    return false
  }
}

/**
 * Wait for a WebSocket to become ready (OPEN state)
 * @param ws - WebSocket instance
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves when ready or rejects on timeout/error
 */
export function waitForWebSocketReady(
  ws: WebSocket,
  timeoutMs: number = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isWebSocketReady(ws)) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const onOpen = () => {
      cleanup()
      resolve()
    }

    const onError = (error: Event) => {
      cleanup()
      reject(new Error('WebSocket connection error'))
    }

    const onClose = () => {
      cleanup()
      reject(new Error('WebSocket closed before ready'))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
      ws.removeEventListener('close', onClose)
    }

    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onError)
    ws.addEventListener('close', onClose)
  })
}

/**
 * Get a human-readable WebSocket state name
 * @param ws - WebSocket instance or null/undefined
 * @returns State name (CONNECTING, OPEN, CLOSING, CLOSED, UNKNOWN)
 */
export function getWebSocketState(ws: WebSocket | null | undefined): string {
  if (!ws) return 'UNKNOWN'

  try {
    switch (ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING'
      case WebSocket.OPEN:
        return 'OPEN'
      case WebSocket.CLOSING:
        return 'CLOSING'
      case WebSocket.CLOSED:
        return 'CLOSED'
      default:
        return 'UNKNOWN'
    }
  } catch {
    return 'UNKNOWN'
  }
}

/**
 * Safely send data through a WebSocket (checks readiness first)
 * @param ws - WebSocket instance
 * @param data - Data to send (string or object that will be JSON.stringify'd)
 * @returns true if sent successfully, false otherwise
 */
export function safeSendWebSocket(
  ws: WebSocket | null | undefined,
  data: string | object
): boolean {
  if (!isWebSocketReady(ws)) return false

  try {
    const message = typeof data === 'string' ? data : JSON.stringify(data)
    ws!.send(message)
    return true
  } catch {
    return false
  }
}

