// Express server entrypoint (ESM)
// Starts the HTTP server for the scanner endpoint used in development.

import { createApp } from './scanner.server.js'
import { attachWsServer } from './ws.server.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

const app = createApp()

const server = app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`)
})

// Attach WebSocket server for dev usage
attachWsServer(server)

// Graceful shutdown in dev
function shutdown() {
    try {
        server.close(() => process.exit(0))
    } catch {
        process.exit(0)
    }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
