// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/e2e/detail-modal-compare.spec.ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Use shared helpers
import { findTableForHeading, clickDetailsByRowId, openDetailsByRowIdRobust } from './helpers'

type TableName = 'Trending Tokens' | 'New Tokens'

// Robust: find first row currently in subscribed state using element evaluation
async function firstSubscribedRowId(page: Page, table: TableName): Promise<string> {
  const tableEl = await findTableForHeading(page, table)
  await expect(tableEl).toBeVisible()
  // Use element handle evaluation to avoid locator stability issues
  const containerHandle = await tableEl.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " table-wrap ")][1]').elementHandle()
  if (!containerHandle) throw new Error('Table container handle not available')
  try {
    const rid = await page.evaluate((el: Element) => {
      const table = (el as Element).querySelector('table.tokens') as HTMLTableElement | null
      if (!table) return null
      const tr = table.querySelector('tbody tr[data-row-state="subscribed"]') as HTMLElement | null
      if (!tr) return null
      return tr.getAttribute('data-row-id') || null
    }, containerHandle)
    if (!rid) throw new Error('No subscribed row found in table')
    return String(rid)
  } finally {
    try { await containerHandle.dispose() } catch {}
  }
}

// Use shared click helper to open details by rowId. This delegates to a DOM evaluate click.
async function openDetailsByRowId(page: Page, rowId: string) {
  // prefer robust in-container click which handles virtualization
  const clicked = await openDetailsByRowIdRobust(page, rowId)
  if (!clicked) {
    // fallback to existing document-based click
    const clicked2 = await clickDetailsByRowId(page, rowId)
    if (!clicked2) throw new Error(`Could not click details for row ${rowId}`)
  }
  await page.waitForTimeout(50)
}

// pickCompareToken unchanged but robustified to avoid flaky locators
async function pickCompareToken(page: Page) {
  const input = page.getByTestId('compare-input')
  await input.click()
  const optionsContainer = input
    .locator('xpath=following::div[contains(@style, "max-height: 260px")]')
    .first()
  await expect(optionsContainer).toBeVisible()
  const options = optionsContainer.locator('> div')
  const count = await options.count()
  for (let i = 0; i < count; i++) {
    try {
      const txt = (await options.nth(i).textContent()) ?? ''
      if (txt.includes('•')) {
        console.log('pickCompareToken: choosing option with bullet:', txt.trim())
        await options.nth(i).click()
        return
      }
    } catch (e) {
      // ignore and try next
    }
  }
  // fallback to first option
  const firstOption = options.first()
  await expect(firstOption).toBeVisible()
  console.log('pickCompareToken: fallback to first option')
  await firstOption.click()
}

function parseRate(text: string): number {
  // Accept either 'upd/s' or 'upd/min' (e.g. "98.57 upd/min (5m avg)"), convert to updates-per-second
  if (!text) return 0
  const mSec = /([0-9]+(?:\.[0-9]+)?)\s*upd\/s/i.exec(text)
  if (mSec) {
    const v = Number(mSec[1])
    return Number.isFinite(v) ? v : 0
  }
  const mMin = /([0-9]+(?:\.[0-9]+)?)\s*upd\/min/i.exec(text)
  if (mMin) {
    const v = Number(mMin[1])
    // convert per-minute to per-second
    return Number.isFinite(v) ? v / 60 : 0
  }
  // fallback: try to find any number and return it (best-effort)
  const mAny = /([0-9]+(?:\.[0-9]+)?)/.exec(text)
  if (mAny) {
    const v = Number(mAny[1])
    return Number.isFinite(v) ? v : 0
  }
  return 0
}

test.describe('DetailModal compare streaming', () => {
  test('Compare rate becomes > 0 and chart leaves Subscribing state', async ({ page }) => {
    await page.goto('/')
    const rowId = await firstSubscribedRowId(page, 'Trending Tokens')
    await openDetailsByRowId(page, rowId)

    await expect(page.getByText('Collecting base data…')).toBeHidden({ timeout: 30_000 })

    await pickCompareToken(page)

    const compareRateContainer = page.locator('text=Compare rate').locator('xpath=..')
    await expect(compareRateContainer).toBeVisible()
    console.log('compareRateContainer visible; starting poll')
    await expect
      .poll(
        async () => {
          const text = (await compareRateContainer.textContent()) ?? ''
          console.log('compareRate raw text:', text)
          return parseRate(text)
        },
        { timeout: 60_000, intervals: [200, 500, 1000, 2000] },
      )
      .toBeGreaterThan(0)

    await expect(page.getByText('(Subscribing…)')).toBeHidden({ timeout: 30_000 })

    const diff = page.getByText('Differential (Base vs Compare)')
    await expect(diff).toBeVisible()
  })

  test('Compare last update timestamp appears ("updated Ns ago")', async ({ page }) => {
    await page.goto('/')
    const rowId = await firstSubscribedRowId(page, 'New Tokens')
    await openDetailsByRowId(page, rowId)
    await pickCompareToken(page)
    await expect(page.getByText(/updated\s+\d+s\s+ago/i)).toBeVisible({ timeout: 30_000 })
  })
})
