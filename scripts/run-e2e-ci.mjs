#!/usr/bin/env node
// Lightweight CI helper to start the deterministic dev server, wait for /scanner,
// run a single Playwright e2e test, and tear down the server. Designed for Linux CI.

import { spawn } from 'child_process'
import fs from 'fs'

const SERVER_CMD = 'pnpm run dev:serve:local'
const SCANNER_URL = process.env.SCAN_URL || 'http://localhost:3001/scanner'
const TEST_CMD = 'TEST_FAST=1 npx playwright test e2e/ws-updates-single.spec.ts --workers=1 --reporter=list'
const START_TIMEOUT_MS = 30000
const POLL_INTERVAL_MS = 250

function spawnServer() {
  console.log('Starting dev server: %s', SERVER_CMD)
  // Launch detached so we can kill the whole process group later.
  const child = spawn('sh', ['-lc', SERVER_CMD], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Pipe server stdout/stderr to files and console for debugging
  const outLog = fs.createWriteStream('server.stdout.log', { flags: 'a' })
  const errLog = fs.createWriteStream('server.stderr.log', { flags: 'a' })
  child.stdout.pipe(outLog)
  child.stderr.pipe(errLog)
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', (d) => process.stderr.write(`[server ERR] ${d}`))

  // Unref to allow script to exit if we choose, but we'll manage teardown explicitly
  try { child.unref() } catch (e) {}
  return child
}

async function waitForScanner(url, timeoutMs = START_TIMEOUT_MS) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const body = await res.json().catch(() => null)
        if (body && Array.isArray(body.pairs)) {
          console.log('Scanner is ready; pairs:', body.pairs.length)
          return true
        }
      }
    } catch (err) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

function runTest() {
  console.log('Running Playwright test: %s', TEST_CMD)
  return new Promise((resolve) => {
    const t = spawn('sh', ['-lc', TEST_CMD], { stdio: 'inherit', shell: false })
    t.on('close', (code) => resolve(code ?? 1))
    t.on('error', (err) => { console.error('Test spawn error', err); resolve(2) })
  })
}

function teardownServer(child) {
  if (!child || !child.pid) return
  console.log('Tearing down server (pid=%d)', child.pid)
  try {
    // Kill entire process group
    process.kill(-child.pid, 'SIGTERM')
  } catch (err) {
    try { child.kill('SIGTERM') } catch (e) {}
  }
}

;(async () => {
  const serverChild = spawnServer()
  try {
    const ok = await waitForScanner(SCANNER_URL, START_TIMEOUT_MS)
    if (!ok) {
      console.error('Scanner did not become ready within timeout; check server.stdout.log and server.stderr.log')
      teardownServer(serverChild)
      process.exit(2)
    }

    const code = await runTest()
    console.log('Playwright exit code:', code)
    teardownServer(serverChild)
    process.exit(code)
  } catch (err) {
    console.error('run-e2e-ci error', err && err.stack ? err.stack : err)
    teardownServer(serverChild)
    process.exit(3)
  }
})()

