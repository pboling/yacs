import { test, expect } from '@playwright/test'

async function getFirstRowCellText(page: import('@playwright/test').Page, table: 'Trending Tokens' | 'New Tokens', nth: number): Promise<string> {
  // Scope table by heading text to avoid ambiguity
  const heading = page.getByRole('heading', { name: table })
  await expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await expect(tableEl).toBeVisible()
  const row = tableEl.locator('tbody tr').first()
  await expect(row).toBeVisible()
  const cell = row.locator(`td:nth-child(${String(nth)})`)
  await expect(cell).toBeVisible()
  const span = cell.locator('span').first()
  const hasSpan = (await span.count()) > 0
  const el = hasSpan ? span : cell
  const text = await el.textContent()
  return text?.trim() ?? ''
}

// Validates that the first row in the Trending Tokens table updates (Price column)
// within a reasonable timeout, indicating that WebSocket updates are flowing
// and the UI is responding.
test('Trending Tokens: first row Price updates from WebSocket', async ({ page }) => {
  await page.goto('/')

  const initial = await getFirstRowCellText(page, 'Trending Tokens', 3)
  expect(initial.length).toBeGreaterThan(0)

  await expect
    .poll(async () => await getFirstRowCellText(page, 'Trending Tokens', 3), { timeout: 20_000, intervals: [250, 500, 1000] })
    .not.toBe(initial)
})

// Validates that the first row in the New Tokens table updates (Liquidity column)
// to ensure both panes react to live updates.
test('New Tokens: first row Liquidity updates from WebSocket', async ({ page }) => {
  await page.goto('/')

  const initial = await getFirstRowCellText(page, 'New Tokens', 9)
  expect(initial.length).toBeGreaterThan(0)

  await expect
    .poll(async () => await getFirstRowCellText(page, 'New Tokens', 9), { timeout: 20_000, intervals: [250, 500, 1000] })
    .not.toBe(initial)
})


// Additional helpers and tests to cover rows reported as problematic in issue
async function getRowCellText(page: import('@playwright/test').Page, table: 'Trending Tokens' | 'New Tokens', rowIndex1Based: number, colIndex1Based: number): Promise<string> {
  const heading = page.getByRole('heading', { name: table })
  await (await import('@playwright/test')).expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await (await import('@playwright/test')).expect(tableEl).toBeVisible()
  const row = tableEl.locator('tbody tr').nth(rowIndex1Based - 1)
  await (await import('@playwright/test')).expect(row).toBeVisible()
  const cell = row.locator(`td:nth-child(${String(colIndex1Based)})`)
  await (await import('@playwright/test')).expect(cell).toBeVisible()
  const span = cell.locator('span').first()
  const hasSpan = (await span.count()) > 0
  const el = hasSpan ? span : cell
  const text = await el.textContent()
  return text?.trim() ?? ''
}

import { test as _test, expect as _expect } from '@playwright/test'

_test('Trending Tokens: rows 2–6 Price update from WebSocket (any row)', async ({ page }) => {
  await page.goto('/')

  // Capture initial Price text for rows 2 through 6
  const initialByRow = new Map<number, string>()
  for (let row = 2; row <= 6; row++) {
    const initial = await getRowCellText(page, 'Trending Tokens', row, 3)
    _expect(initial.length).toBeGreaterThan(0)
    initialByRow.set(row, initial)
  }

  // Poll until at least one of rows 2–6 has a different Price text
  await _expect
    .poll(async () => {
      for (let row = 2; row <= 6; row++) {
        const current = await getRowCellText(page, 'Trending Tokens', row, 3)
        const initial = initialByRow.get(row) ?? ''
        if (current !== initial) return true
      }
      return false
    }, { timeout: 20_000, intervals: [250, 500, 1000] })
    .toBe(true)
})

_test('New Tokens: Liquidity updates from WebSocket (any of first rows)', async ({ page }) => {
  await page.goto('/')

  // Determine how many rows are currently rendered (at least 1 expected)
  const heading = page.getByRole('heading', { name: 'New Tokens' })
  await _expect(heading).toBeVisible()
  const tableEl = heading.locator('..').locator('table.tokens')
  await _expect(tableEl).toBeVisible()
  const rows = tableEl.locator('tbody tr')
  // Wait until at least one row has rendered
  await _expect
    .poll(async () => await rows.count(), { timeout: 20_000, intervals: [250, 500, 1000] })
    .toBeGreaterThan(0)
  const count = await rows.count()
  const limit = Math.min(6, count)

  // Capture initial Liquidity text for rows 1..limit
  const initialByRow = new Map<number, string>()
  for (let row = 1; row <= limit; row++) {
    const initial = await getRowCellText(page, 'New Tokens', row, 9)
    _expect(initial.length).toBeGreaterThan(0)
    initialByRow.set(row, initial)
  }

  // Poll until any of the observed rows changes Liquidity text
  await _expect
    .poll(async () => {
      for (let row = 1; row <= limit; row++) {
        const current = await getRowCellText(page, 'New Tokens', row, 9)
        const initial = initialByRow.get(row) ?? ''
        if (current !== initial) return true
      }
      return false
    }, { timeout: 20_000, intervals: [250, 500, 1000] })
    .toBe(true)
})
