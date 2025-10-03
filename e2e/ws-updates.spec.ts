import { test, expect } from '@playwright/test'

// Use shared helpers from e2e/helpers.ts
import {
  findTableForHeading,
  getRowIdsForTokens,
  getCellTextByToken,
  scrollRowIntoViewByToken,
  clickDetailsByToken,
  clickDetailsByRowId,
  generateDeterministicTokens,
  parseCounter,
} from './helpers'

// Single focused test with a simple name (no parens) so -g regex is easy
test('NewTokensSells', async ({ page }) => {
  page.on('console', (msg) => console.log(`PAGE LOG [${msg.type()}]: ${msg.text()}`))
  await page.goto('/')

  // sort by token column in the New Tokens table
  const tableName = 'New Tokens'
  const tableEl = await findTableForHeading(page, tableName)
  const ths = tableEl.locator('thead tr th')
  const count = await ths.count()
  let tokenHeaderIdx = -1
  for (let i = 0; i < count; i++) {
    const thText = (await ths.nth(i).textContent())?.trim().toLowerCase()
    if (thText && thText.includes('token')) { tokenHeaderIdx = i; break }
  }
  if (tokenHeaderIdx === -1) throw new Error('Token header not found')
  await ths.nth(tokenHeaderIdx).click()
  await page.waitForTimeout(300)

  // build monitored token list from deterministic generator
  // Prefer tokens from the deterministic REST /scanner so the test matches the app's dataset.
  // Fall back to `generateDeterministicTokens` if the REST endpoint is unavailable.
  let tokens: string[] = []
  try {
    const resp = await page.request.get('http://localhost:3001/scanner')
    if (resp.ok()) {
      const body = await resp.json() as any
      if (body && Array.isArray(body.pairs)) {
        const seen = new Set()
        for (const p of body.pairs as any[]) {
          const s = (p.token1Symbol || p.token1Name || '')
          if (!s) continue
          const lower = String(s).trim().toLowerCase()
          if (!lower) continue
          if (!seen.has(lower)) {
            seen.add(lower)
            tokens.push(String(s).trim())
            if (tokens.length >= 50) break
          }
        }
      }
    }
  } catch (err: any) {
    /* ignore fetch errors and fallback */
  }
  if (!tokens.length) tokens = generateDeterministicTokens(50)
  console.log('using tokens (first 10):', tokens.slice(0, 10).join(', '))
  console.log('using tokens (count):', tokens.length)

  // Try to locate rows for the monitored tokens with retries. If we fail, print
  // helpful diagnostic info: the /scanner pair list and a DOM snapshot of the
  // currently-rendered table rows so test debugging can proceed quickly.
  let monitoredRows: { rowId: string; token: string }[] = []
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    monitoredRows = await getRowIdsForTokens(page, tableName, tokens)
    if (monitoredRows.length) break
    console.log(`Attempt ${attempt}: no monitored rows found — collecting diagnostics`)
    // Fetch /scanner tokens for diagnosis
    try {
      const resp = await page.request.get('http://localhost:3001/scanner')
      if (resp.ok()) {
        const body = await resp.json() as any
        const scannerTokens: { token: string; pair: string }[] = Array.isArray(body.pairs) ? (body.pairs as any[]).map((p: any) => ({ token: (p.token1Symbol || p.token1Name || ''), pair: p.pairAddress || p.pair || p.id || '' })).slice(0, 50) : []
        console.log('scanner entries (first 50):', scannerTokens.map((s) => `${s.token}@${s.pair}`).join(', '))
      } else {
        console.log('scanner fetch failed during diagnostic:', resp.status, resp.statusText)
      }
    } catch (err) {
      const e: any = err
      console.log('scanner fetch error during diagnostic:', e && e.stack ? e.stack : e)
    }

    // DOM snapshot of currently-rendered rows (element-handle based)
    try {
      const containerHandle = await tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]').elementHandle()
      if (containerHandle) {
        const domRows = await page.evaluate((el: Element) => {
          const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
          if (!table) return []
          return Array.from(table.querySelectorAll('tbody tr')).slice(0, 200).map(tr => {
            const rid = tr.getAttribute('data-row-id')
            const td = tr.querySelector('td')
            const raw = td ? (td.textContent || '').trim() : ''
            let token = ''
            if (raw) {
              const m = raw.match(/[A-Za-z0-9-]+/)
              token = m ? m[0] : raw
            }
            return { rid, token }
          })
        }, containerHandle)
        console.log('DOM rows snapshot (first 200):', JSON.stringify((domRows || []).slice(0, 50)))
        try { await containerHandle.dispose() } catch {}
      }
    } catch (err) {
      const e: any = err
      console.log('DOM snapshot error during diagnostic:', e && e.stack ? e.stack : e)
    }

    // Small backoff before retrying
    await page.waitForTimeout(200)
  }

  if (!monitoredRows.length) {
    throw new Error('No monitored tokens found after retries; see previous diagnostics logs for /scanner and DOM rows')
  }
  console.log('Found monitored tokens in table:', monitoredRows.map(r => r.token).join(', '))
  console.log('monitoredRows (detailed):', JSON.stringify(monitoredRows.slice(0, 50)))
  try {
    const containerHandle2 = await tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]').elementHandle()
    if (containerHandle2) {
      const domRows2 = await page.evaluate((el: Element) => {
        const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
        if (!table) return []
        return Array.from(table.querySelectorAll('tbody tr')).slice(0, 200).map(tr => ({ rid: tr.getAttribute('data-row-id'), text: (tr.querySelector('td')?.textContent || '').trim() }))
      }, containerHandle2)
      console.log('DOM rows (before subscribe) snapshot (first 200):', JSON.stringify(domRows2.slice(0, 50)))
      try { await containerHandle2.dispose() } catch {}
    }
  } catch (err) {
    const e: any = err
    console.log('pre-subscribe DOM snapshot error:', e && e.stack ? e.stack : e)
  }

  // Build a token->rowId map for fallbacks
  const tokenToRow = new Map<string, string>()
  for (const r of monitoredRows) tokenToRow.set(r.token, r.rowId)

  // subscribe + open details for first to accelerate updates
  const validTokens: string[] = []
  for (let i = 0; i < monitoredRows.length; i++) {
    const token = monitoredRows[i].token
    try {
      const scrolled = await scrollRowIntoViewByToken(page, tableName, token)
      if (!scrolled) {
        // fallback: try clicking by rowId if we have it
        const rid = tokenToRow.get(token)
        if (rid) {
          const clicked = await clickDetailsByRowId(page, rid)
          if (clicked) {
            validTokens.push(token)
            continue
          }
        }
        console.log(`Could not find/scroll row for token ${token}`)
        continue
      }
      // short wait for any virtualized subscription to happen
      await page.waitForTimeout(80)
      if (validTokens.length === 0) {
        // open details for the first valid token
        const clicked = await clickDetailsByToken(page, tableName, token)
        if (!clicked) {
          // try fallback by rowId
          const rid = tokenToRow.get(token)
          if (rid) await clickDetailsByRowId(page, rid)
        }
      }
      validTokens.push(token)
    } catch (err) {
      const e: any = err
      console.log(`Error acting on token ${token}:`, e && e.stack ? e.stack : e)
    }
  }
  if (!validTokens.length) throw new Error('No monitored tokens remained after attempting to scroll/click rows')
  await page.waitForTimeout(150)

  // Read initial counters by token (use validTokens)
  const initialPairs = await Promise.all(validTokens.map(async (token) => {
    const raw = await getCellTextByToken(page, tableName, token, 8)
    return { buys: parseCounter(raw, 'buys'), sells: parseCounter(raw, 'sells') }
  }))
  const initialMax = initialPairs.map(p => Math.max(p.buys, p.sells))
  console.log('Initial counters (buys/sells):', initialPairs)

  // pass as soon as any monitored token's buys or sells increases
  await Promise.any(validTokens.map((token, idx) =>
    expect.poll(async () => {
      const raw = await getCellTextByToken(page, tableName, token, 8)
      const buys = parseCounter(raw, 'buys')
      const sells = parseCounter(raw, 'sells')
      const v = Math.max(buys, sells)
      console.log(`Polled ${token} => buys:${buys} sells:${sells} max:${v}`)
      return v
    }, { timeout: 60000, intervals: [100,250,500,1000,2000] }).toBeGreaterThan(initialMax[idx])
  ))
})
