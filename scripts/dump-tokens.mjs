// Lightweight dump script that queries the local deterministic REST `/scanner` endpoint
// and prints pair ids and token symbols. This avoids launching any browsers so it works
// in environments where Playwright browsers cannot be installed or launched.

const url = process.env.SCAN_URL || 'http://localhost:3001/scanner'

try {
  console.log('dump-tokens: fetching', url)
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    console.error('dump-tokens: scanner responded with', res.status, res.statusText)
    process.exitCode = 2
  } else {
    const body = await res.json()
    const pairs = Array.isArray(body.pairs) ? body.pairs : []
    console.log('Found pairs:', pairs.length)
    for (let i = 0; i < Math.min(pairs.length, 200); i++) {
      const p = pairs[i]
      const id = p.pairAddress || p.pair || p.id || null
      const token = p.token1Symbol || p.token1Name || p.token1 || p.token || ''
      console.log(`${i+1}. id=${id} token=${token}`)
    }
  }
} catch (err) {
  console.error('dump-tokens: error fetching scanner:', err && err.stack ? err.stack : err)
  process.exitCode = 2
}
