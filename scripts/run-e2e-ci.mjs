#!/usr/bin/env node
// Lightweight CI helper to start the deterministic dev server, wait for /scanner,
// run a single Playwright e2e test, and tear down the server. Designed for Linux CI.

import { spawn } from 'child_process'
import fs from 'fs'

const SERVER_CMD = 'pnpm run dev:serve:local'
const SCANNER_URL = process.env.SCAN_URL || 'http://localhost:3001/scanner'
// Allow overriding the exact test files via TEST_FILES environment variable.
// TEST_FILES may be a comma- or space-separated list of paths. Default to both
// existing e2e test files in this repo.
const DEFAULT_TEST_FILES = ['e2e/ws-updates.spec.ts', 'e2e/detail-modal-compare.spec.ts']
const TEST_FILES =
  process.env.TEST_FILES && String(process.env.TEST_FILES).trim()
    ? String(process.env.TEST_FILES)
        .split(/\s*(?:,|\s)\s*/)
        .filter(Boolean)
    : DEFAULT_TEST_FILES

// We'll invoke Playwright directly via spawn with an argv array so we don't
// need to build a shell command or worry about quoting. We run Playwright
// with TEST_FAST unset in its process environment (so the test runner's
// behavior matches a manual `npx playwright test ...` run) while keeping the
// server started by this helper in TEST_FAST mode (if desired).
//
const PLAYWRIGHT_ARGS_BASE = ['playwright', 'test', ...TEST_FILES, '--workers=1', '--reporter=list']
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
  try {
    child.unref()
  } catch (e) {}
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
  const args = PLAYWRIGHT_ARGS_BASE.slice()
  console.log('Running Playwright via:', 'npx', args.join(' '))
  return new Promise((resolve) => {
    // Build a controlled env for the Playwright process: copy current env,
    // but remove TEST_FAST so Playwright runs without that override.
    const env = { ...process.env }
    if ('TEST_FAST' in env) delete env.TEST_FAST

    const t = spawn('npx', args, { stdio: 'inherit', env })
    t.on('close', (code) => resolve(code ?? 1))
    t.on('error', (err) => {
      console.error('Test spawn error', err)
      resolve(2)
    })
  })
}

function teardownServer(child) {
  if (!child || !child.pid) return
  console.log('Tearing down server (pid=%d)', child.pid)
  try {
    // Kill entire process group
    process.kill(-child.pid, 'SIGTERM')
  } catch (err) {
    try {
      child.kill('SIGTERM')
    } catch (e) {}
  }
}

;(async () => {
  const serverChild = spawnServer()
  try {
    const ok = await waitForScanner(SCANNER_URL, START_TIMEOUT_MS)
    if (!ok) {
      console.error(
        'Scanner did not become ready within timeout; check server.stdout.log and server.stderr.log',
      )
      teardownServer(serverChild)
      process.exit(2)
    }

    // Pre-flight check: ensure each requested Playwright test file exists so we fail fast
    const missing = TEST_FILES.filter((f) => !fs.existsSync(f))
    if (missing.length) {
      console.error('One or more Playwright test files were not found:')
      for (const m of missing) console.error('  ' + m)
      try {
        const e2eFiles = fs
          .readdirSync('e2e')
          .filter((f) => f.endsWith('.ts') || f.endsWith('.spec.ts'))
        console.error('Available e2e files:')
        for (const f of e2eFiles) console.error('  ' + f)
      } catch (e) {
        // ignore directory read errors
      }
      teardownServer(serverChild)
      process.exit(4)
    }

    console.log('Running tests:', TEST_FILES.join(', '))
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
