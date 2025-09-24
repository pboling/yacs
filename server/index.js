// Express server entrypoint (ESM)
// Starts the HTTP server for the scanner endpoint used in development.

import { createApp } from './scanner.server.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'

const app = createApp()

const server = app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on http://${HOST}:${PORT}`)
})

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
