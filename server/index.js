// Express server entrypoint (ESM)
// Starts the HTTP server for the scanner endpoint used in development.

import { createApp } from './scanner.server.js'
import { attachWsServer } from './ws.server.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

const app = createApp()

// Create server and attach listeners to surface errors (EADDRINUSE) instead of
// letting them throw as unhandled 'error' events which crashed the process in logs.
const server = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`)
})

// Attach a listener for server 'error' to avoid unhandled exceptions (seen as EADDRINUSE)
server.on('error', (err) => {
  try {
    console.error('[server] HTTP server error:', err && err.stack ? err.stack : err)
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `[server] port ${PORT} already in use. If another instance is running, stop it or set PORT to a different value.`,
      )
    }
  } catch {
    // ignore logging errors
  }
  // In dev, crash to surface to concurrently runner (same behavior as before) but with clear message
  try {
    process.exit(1)
  } catch {
    /* no-op */
  }
})

// Add handler to avoid raw socket errors bubbling as unhandled exceptions
server.on('clientError', (err, socket) => {
  try {
    console.warn('[server] clientError:', err && err.stack ? err.stack : err)
    // Gracefully close socket if possible
    if (socket && !socket.destroyed) {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {}
    }
  } catch {
    /* ignore */
  }
})

// Attach WebSocket server for dev usage
const wss = attachWsServer(server)

// Graceful shutdown in dev (ensure WS clients are closed so process can exit)
function shutdown() {
  console.log('[server] received shutdown signal; closing...')
  try {
    // Close all WS clients to stop their timers/intervals
    if (wss) {
      try {
        for (const client of wss.clients) {
          try {
            client.terminate()
          } catch {}
        }
        wss.close(() => {
          // after WS closes, close HTTP server
          try {
            server.close(() => process.exit(0))
          } catch {
            process.exit(0)
          }
        })
      } catch {
        // Even if closing wss fails, attempt to close HTTP
        try {
          server.close(() => process.exit(0))
        } catch {
          process.exit(0)
        }
      }
    } else {
      server.close(() => process.exit(0))
    }
    // Fallback: force-exit after short grace period to avoid hanging in dev
    setTimeout(() => process.exit(0), 2000).unref?.()
  } catch {
    process.exit(0)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
