// Shared deterministic token fixture for backend and frontend
import fs from 'node:fs'
import path from 'node:path'

// Load symbols from src/config/symbols.yaml
export function loadSymbols() {
  const yamlPath = path.resolve(process.cwd(), 'src/config/symbols.yaml')
  const text = fs.readFileSync(yamlPath, 'utf-8')
  const lines = text.split(/\r?\n/)
  const items = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('- ')) {
      let v = line.slice(2).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (v) items.push(v)
    }
  }
  const allAlpha = items.every((w) => /^[A-Za-z]+$/.test(w))
  const allFive = allAlpha && items.every((w) => w.length === 5)
  const allFiveWithSuffix = items.every((w) => /^[A-Za-z]{5}\d{4}$/.test(w))
  if (allFiveWithSuffix && items.length >= 2000) return items
  if (allFive && items.length > 0) {
    const expanded = []
    const target = Math.max(2000, 2500)
    for (let i = 1; i <= target; i++) {
      const word = items[(i - 1) % items.length]
      expanded.push(`${word}${String(i).padStart(4, '0')}`)
    }
    return expanded
  }
  return items
}

// Deterministic PRNG (mulberry32)
export function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Generate deterministic tokens
export function generateDeterministicTokens(count = 50, seed = 12345) {
  const symbols = loadSymbols()
  const rand = mulberry32(seed)
  const tokens = []
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rand() * symbols.length)
    tokens.push(symbols[idx])
  }
  return tokens
}

