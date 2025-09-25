import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function getFirstRowCellText(page: Page, table: 'Trending Tokens' | 'New Tokens', nth: number): Promise<string> {
    const heading = page.getByRole('heading', { name: table })
    await expect(heading).toBeVisible()
    const tableEl = heading.locator('..').locator('table.tokens')
    await expect(tableEl).toBeVisible()
    const row = tableEl.locator('tbody tr').first()
    await expect(row).toBeVisible()
    const cell = row.locator(`td:nth-child(${String(nth)})`)
    await expect(cell).toBeVisible()
    // Buys/Sells cell renders two NumberCell components separated by '/'
    const text = (await cell.textContent())?.trim() ?? ''
    return text
}

// Regression: Verify Buys specifically increase from WebSocket ticks.
// This guards against scenarios where only Sells were changing and Buys stayed static.
// Column indices (1-based): 1 Token, 2 Exchange, 3 Price, 4 MCap, 5 Volume, 6 Chg, 7 Age, 8 Buys/Sells, 9 Liquidity.

function parseBuys(text: string): number {
    // Expect formats like "12/3" or with spaces due to rendering
    const cleaned = text.replace(/\s+/g, '')
    const [buys] = cleaned.split('/')
    const n = Number(buys)
    return Number.isFinite(n) ? n : 0
}

 test('Trending Tokens: first row Buys increases from WebSocket ticks', async ({ page }) => {
     await page.goto('/')
 
     const initialText = await getFirstRowCellText(page, 'Trending Tokens', 8)
     expect(initialText.length).toBeGreaterThan(0)
     const initialBuys = parseBuys(initialText)
 
     await expect
         .poll(async () => parseBuys(await getFirstRowCellText(page, 'Trending Tokens', 8)), { timeout: 20_000, intervals: [100, 250, 500, 1000] })
         .toBeGreaterThan(initialBuys)
 })
 
 // Also assert on New Tokens pane to ensure both tables receive tx counter updates
 test('New Tokens: first row Buys increases from WebSocket ticks', async ({ page }) => {
     await page.goto('/')
 
     const initialText = await getFirstRowCellText(page, 'New Tokens', 8)
     expect(initialText.length).toBeGreaterThan(0)
     const initialBuys = parseBuys(initialText)
 
     await expect
         .poll(async () => parseBuys(await getFirstRowCellText(page, 'New Tokens', 8)), { timeout: 20_000, intervals: [100, 250, 500, 1000] })
         .toBeGreaterThan(initialBuys)
 })
