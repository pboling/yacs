import { Page, test, expect } from '@playwright/test'

async function getFirstRowCellText(page: Page, table: 'Trending Tokens' | 'New Tokens', nth: number): Promise<string> {
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
