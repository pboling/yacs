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

_test('Trending Tokens: rows 2–6 Price update from WebSocket', async ({ page }) => {
  await page.goto('/')
  for (let row = 2; row <= 6; row++) {
    const initial = await getRowCellText(page, 'Trending Tokens', row, 3)
    _expect(initial.length).toBeGreaterThan(0)
    await _expect
      .poll(async () => await getRowCellText(page, 'Trending Tokens', row, 3), { timeout: 20_000, intervals: [250, 500, 1000] })
      .not.toBe(initial)
  }
})

_test('New Tokens: third row Liquidity updates from WebSocket', async ({ page }) => {
  await page.goto('/')
  const initial = await getRowCellText(page, 'New Tokens', 3, 9)
  _expect(initial.length).toBeGreaterThan(0)
  await _expect
    .poll(async () => await getRowCellText(page, 'New Tokens', 3, 9), { timeout: 20_000, intervals: [250, 500, 1000] })
    .not.toBe(initial)
})
