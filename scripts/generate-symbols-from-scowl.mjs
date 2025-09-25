// scripts/generate-symbols-from-scowl.mjs
// ESM script to generate src/config/symbols.yaml from SCOWL word list
// Rules:
// - Source: src/config/en_US-large.txt
// - Only ASCII alphabetic words (A-Za-z)
// - Group by starting letter (A-Z)
// - For each letter group, select exactly up to 100 words total:
//    - Prefer words with length 1..5
//    - Include up to 10 words with length >5 per letter group
// - Output: simple YAML list (one '- word' per line), lowercased
// - Deterministic: selection sorted lexicographically by lowercase, then by length

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.resolve(__dirname, '..')
const srcPath = path.join(projectRoot, 'scripts', 'en_US-large.txt')
const outPath = path.join(projectRoot, 'src', 'config', 'symbols.yaml')

const raw = fs.readFileSync(srcPath, 'utf-8')

const lines = raw.split(/\r?\n/)
const isAsciiAlpha = (s) => /^[A-Za-z]+$/.test(s)
const byLetter = new Map()

for (const line of lines) {
  const w = line.trim()
  if (!w) continue
  if (!isAsciiAlpha(w)) continue
  const lower = w.toLowerCase()
  const letter = lower[0]
  if (!letter) continue
  if (letter < 'a' || letter > 'z') continue
  if (!byLetter.has(letter)) byLetter.set(letter, new Set())
  byLetter.get(letter).add(lower)
}

const selected = []
for (let code = 'a'.charCodeAt(0); code <= 'z'.charCodeAt(0); code++) {
  const letter = String.fromCharCode(code)
  const set = byLetter.get(letter) || new Set()
  const arr = Array.from(set)
  // Sort deterministically: primary lexicographic, secondary by length
  arr.sort((a, b) => a.localeCompare(b) || a.length - b.length)
  const short = arr.filter(w => w.length <= 5)
  const long = arr.filter(w => w.length > 5)
  const longPick = Math.min(10, long.length)
  const need = 100
  const out = []
  // Take up to 10 long words first (still within the overall 100 cap)
  for (let i = 0; i < longPick && out.length < need; i++) out.push(long[i])
  // Fill the rest with short words
  for (let i = 0; i < short.length && out.length < need; i++) out.push(short[i])
  // If we still don't have 100 due to too few short words, do NOT exceed 10 long words per requirements
  // Therefore we accept fewer than 100 if necessary.
  // However, in SCOWL large lists this should rarely happen.
  for (const w of out) selected.push(w)
}

// Write YAML (one item per line)
const yamlLines = selected.map(w => `- ${w}`)
fs.writeFileSync(outPath, yamlLines.join('\n') + '\n', 'utf-8')

console.log(`Wrote ${selected.length} words to ${outPath}`)
