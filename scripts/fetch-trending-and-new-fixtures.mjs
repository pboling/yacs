// scripts/fetch-trending-and-new-fixtures.mjs
// Generate two REST fixtures exactly like the client App does on boot:
// - Trending preset (volume-desc with age<=7d, minVol, exclude honeypots)
// - New preset (age-desc with age<=24h, exclude honeypots)
// It saves both raw payloads under tests/fixtures and prints whether they are identical.
//
// Why: This lets us verify NOW (outside the running app) if the backend returns
// the same dataset for both presets so we can make an informed decision about
// deduping requests at runtime.
//
// Usage:
//   node scripts/fetch-trending-and-new-fixtures.mjs
//   API_BASE=https://api-rs.dexcelerate.com node scripts/fetch-trending-and-new-fixtures.mjs
//   # (API_BASE defaults to the client default in src/scanner.client.js)
//
// Output:
//   tests/fixtures/scanner.trending.json
//   tests/fixtures/scanner.new.json
//   tests/fixtures/scanner.compare.txt (summary)

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Mirror the presets used by the app at boot (see src/test-task-types.ts)
// We re-declare here to avoid importing TypeScript from Node without a loader.
const TRENDING_TOKENS_FILTERS = {
  rankBy: 'volume',
  orderBy: 'desc',
  minVol24H: 1000, // minimum $1k volume
  isNotHP: true, // exclude honeypots
  maxAge: 7 * 24 * 60 * 60, // max 7 days old (seconds)
}

const NEW_TOKENS_FILTERS = {
  rankBy: 'age',
  orderBy: 'desc', // newest first
  maxAge: 24 * 60 * 60, // max 24 hours old (seconds)
  isNotHP: true,
}

function withTimeoutFetch(ms = 8000) {
  return async (url, opts = {}) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), ms)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      return res
    } finally {
      clearTimeout(id)
    }
  }
}

async function saveJson(filename, json) {
  const outDir = path.resolve(__dirname, '..', 'tests', 'fixtures')
  await fs.mkdir(outDir, { recursive: true })
  const outFile = path.resolve(outDir, filename)
  await fs.writeFile(outFile, JSON.stringify(json, null, 2))
  const count = Array.isArray(json.scannerPairs)
    ? json.scannerPairs.length
    : Array.isArray(json.pairs)
      ? json.pairs.length
      : 0
  console.log(`Saved ${filename} with ${count} items`)
  return outFile
}

function pickPairsArray(raw) {
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.scannerPairs)) return raw.scannerPairs
    if (Array.isArray(raw.pairs)) return raw.pairs
  }
  return []
}

function extractPairAddresses(list) {
  const out = []
  for (const it of Array.isArray(list) ? list : []) {
    const p = it && it.pairAddress
    if (typeof p === 'string' && p) out.push(p.toLowerCase())
  }
  return out
}

async function main() {
  const { fetchScanner, API_BASE: CLIENT_DEFAULT_BASE } = await import('../src/scanner.client.js')
  // Allow override via env, else use client default (which is public API in prod)
  const baseUrl = process.env.API_BASE || CLIENT_DEFAULT_BASE
  const fetchImpl = withTimeoutFetch(12000)

  console.log('[fixture:sets] Using API base:', baseUrl)

  // Always page=1 for boot
  const trendingParams = { ...TRENDING_TOKENS_FILTERS, page: 1 }
  const newParams = { ...NEW_TOKENS_FILTERS, page: 1 }

  const [{ raw: rawTrending }, { raw: rawNew }] = await Promise.all([
    fetchScanner(trendingParams, { baseUrl, fetchImpl }),
    fetchScanner(newParams, { baseUrl, fetchImpl }),
  ])

  const f1 = await saveJson('scanner.trending.json', rawTrending)
  const f2 = await saveJson('scanner.new.json', rawNew)

  // Compare sets by pairAddress (case-insensitive), ignore ordering
  const a1 = extractPairAddresses(pickPairsArray(rawTrending)).sort()
  const a2 = extractPairAddresses(pickPairsArray(rawNew)).sort()

  const sameLength = a1.length === a2.length
  let different = !sameLength
  if (!different) {
    for (let i = 0; i < a1.length; i++) {
      if (a1[i] !== a2[i]) {
        different = true
        break
      }
    }
  }

  let summary = ''
  if (!different) {
    summary = 'Trending and New fixtures contain identical pairAddress sets.'
  } else {
    const set1 = new Set(a1)
    const set2 = new Set(a2)
    const onlyInTrending = Array.from(set1).filter((x) => !set2.has(x))
    const onlyInNew = Array.from(set2).filter((x) => !set1.has(x))
    summary = [
      'Trending and New fixtures differ.',
      `Only in Trending (${onlyInTrending.length}): ${onlyInTrending.slice(0, 20).join(', ')}`,
      `Only in New (${onlyInNew.length}): ${onlyInNew.slice(0, 20).join(', ')}`,
      onlyInTrending.length > 20 || onlyInNew.length > 20
        ? '(…truncated list; see JSON files for full details)'
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  console.log('\n[fixture:sets] Comparison summary:\n' + summary + '\n')
  const comparePath = path.resolve(__dirname, '..', 'tests', 'fixtures', 'scanner.compare.txt')
  await fs.writeFile(comparePath, summary + `\nFiles:\n- ${f1}\n- ${f2}\n`)
  console.log('Wrote comparison summary to', comparePath)
}

main().catch((err) => {
  console.error('[fixture:sets] Failed:', err?.message || err)
  process.exitCode = 1
})
