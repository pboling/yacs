import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// This test ensures that critical imports used by the React entry compile path exist on disk.
// It acts as a fast regression guard that fails before starting the dev server if a file is missing.

test('critical imports referenced by App.tsx exist', () => {
  const appPath = resolve(__dirname, '..', 'src', 'App.tsx')
  const srcDir = resolve(__dirname, '..', 'src')
  const content = readFileSync(appPath, 'utf8')

  // Collect only relative imports that end with .js or .ts from App.tsx — Vite resolves these in dev.
  const importRegex = /import\s+[^"'\n]+from\s+["'](\.\S*?\.(?:js|ts))["']/g
  const imports = []
  let m
  while ((m = importRegex.exec(content)) !== null) {
    imports.push(m[1])
  }

  // Minimal set we care about right now (acts as a contract):
  const required = [
    ['./scanner.client.js'],
    ['./tokens.reducer.js'],
    ['./ws.subs.js', './ws.subs.ts'], // allow either the JS original or TS shim
  ]

  for (const alts of required) {
    const present = alts.some((rel) => imports.includes(rel))
    assert.ok(present, `App.tsx should import one of: ${alts.join(', ')}`)
    const existing = alts.find((rel) => existsSync(resolve(srcDir, rel)))
    assert.ok(existing, `At least one of these files must exist on disk: ${alts.join(', ')}`)
  }
})
