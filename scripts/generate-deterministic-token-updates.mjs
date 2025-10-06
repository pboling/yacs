// Generate the ordered list of token updates based on the current deterministic logic and seed
import { getBaseSeed, mixSeeds } from '../src/seed.util.js'
import fs from 'node:fs'
import path from 'node:path'

// Deterministic PRNG (mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Load symbols from config/symbols.yaml (same logic as src/scanner.endpoint.js)
function loadSymbols() {
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

// Simulate deterministic token update order
function generateTokenUpdateOrder(seed, count = 50) {
  const symbols = loadSymbols()
  const rnd = mulberry32(seed)
  // For demo: pick 'count' tokens in deterministic order
  // (In reality, your update logic may be more complex)
  const updates = []
  const used = new Set()
  while (updates.length < count && used.size < symbols.length) {
    const idx = Math.floor(rnd() * symbols.length)
    const token = symbols[idx]
    if (!used.has(token)) {
      updates.push(token)
      used.add(token)
    }
  }
  return updates
}

// Main
const seed = getBaseSeed()
const updates = generateTokenUpdateOrder(seed, 50)
console.log('Deterministic token update order:')
updates.forEach((token, i) => {
  console.log(`${i + 1}. ${token}`)
})
