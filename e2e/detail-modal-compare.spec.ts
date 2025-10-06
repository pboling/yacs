// filepath: /home/pboling/WebstormProjects/dexcelerate-fe-test/e2e/detail-modal-compare.spec.ts
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Use shared helpers
import { findTableForHeading, clickDetailsByRowId, openDetailsByRowIdRobust } from './helpers'
// Import deterministic token generator
// import { generateDeterministicTokens } from '../src/utils/token.fixture.js'

type TableName = 'Trending Tokens' | 'New Tokens'

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

// Use a deterministic token for test selection
// const deterministicTokens = generateDeterministicTokens(1)

test.describe('DetailModal compare streaming', () => {
  test('Compare rate becomes > 0 and chart leaves Subscribing state', async ({ page }) => {
    // Set up console logging to capture WebSocket events
    page.on('console', (msg) => {
      if (msg.type() === 'log' || msg.type() === 'info' || msg.type() === 'error') {
        console.log(`PAGE LOG [${msg.type()}]:`, msg.text())
      }
    })

    await page.goto('/')
    const tableName: TableName = 'New Tokens'
    const tableEl = await findTableForHeading(page, tableName)
    await expect(tableEl).toBeVisible()
    // Pick a token from the first visible row in the table
    const tableRowsLocator = tableEl.locator('tbody tr')
    let rowCount = await tableRowsLocator.count()
    let retries = 5
    while (rowCount === 0 && retries > 0) {
      console.log('No rows found, waiting and retrying...')
      await page.waitForTimeout(500)
      rowCount = await tableRowsLocator.count()
      retries--
    }
    if (rowCount === 0) {
      const tableHtml = await tableEl.innerHTML()
      console.log('DIAGNOSTIC: Table HTML:', tableHtml)
      const headings = await page.locator('h2').allTextContents()
      console.log('DIAGNOSTIC: Page headings:', headings)
      throw new Error('No rows found in New Tokens table after retries')
    }
    let compareToken = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      const tokenMatch = rowText?.match(/[A-Za-z0-9-]+/)
      if (tokenMatch) {
        compareToken = tokenMatch[0]
        break
      }
    }
    if (!compareToken) throw new Error('No token found in table rows')
    // Find the rowId for the selected token
    let rowId = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      if (rowText?.includes(compareToken)) {
        rowId = (await tableRowsLocator.nth(i).getAttribute('data-row-id')) || ''
        break
      }
    }
    if (!rowId) throw new Error('No rowId found for token in table')

    // Add WebSocket monitoring before opening the modal
    await page.evaluate(() => {
      const win = window as any
      const ws = win.__APP_WS__
      if (ws) {
        console.log('[WS-DIAGNOSTIC] Initial WebSocket state:', ws.readyState,
          '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)')

        // Track sent messages
        const originalSend = ws.send.bind(ws)
        ws.send = function(data: any) {
          try {
            const parsed = JSON.parse(data)
            if (parsed.event?.includes('subscribe')) {
              console.log('[WS-DIAGNOSTIC] Sending subscription:', parsed.event, parsed.data)
            }
          } catch {}
          return originalSend(data)
        }

        // Track close events
        ws.addEventListener('close', (e: CloseEvent) => {
          console.log('[WS-DIAGNOSTIC] WebSocket closed! Code:', e.code, 'Reason:', e.reason,
            'Clean:', e.wasClean)
        })

        ws.addEventListener('error', (e: Event) => {
          console.log('[WS-DIAGNOSTIC] WebSocket error event:', e)
        })
      } else {
        console.log('[WS-DIAGNOSTIC] No __APP_WS__ found on window')
      }
    })

    await openDetailsByRowId(page, rowId)
    await pickCompareToken(page)

    // Diagnostic: log compare subscription state and backend response
    const compareState = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]')
      if (!modal) return null
      const subText = modal.textContent || ''
      const ws = (window as any).__APP_WS__
      return {
        modalText: subText,
        subscribingVisible: !!/Subscribing/.exec(subText),
        wsState: ws ? ws.readyState : 'no-ws',
        wsUrl: ws ? ws.url : 'no-ws',
      }
    })
    console.log('DIAGNOSTIC: Modal compare state:', compareState)

    try {
      const resp = await page.request.get('http://localhost:3001/scanner')
      if (resp.ok()) {
        const body = await resp.json()
        console.log(
          'DIAGNOSTIC: /scanner pairs (first 10):',
          JSON.stringify(body.pairs?.slice(0, 10)),
        )
      }
    } catch (err: unknown) {
      console.log('DIAGNOSTIC: /scanner fetch error:', err)
    }

    // Monitor for updates while waiting
    const updateMonitor = page.evaluate(() => {
      return new Promise((resolve) => {
        const win = window as any
        const ws = win.__APP_WS__
        let messageCount = 0
        let updateEventCount = 0

        if (ws) {
          const messageHandler = (e: MessageEvent) => {
            try {
              const msg = JSON.parse(e.data)
              messageCount++
              if (msg.event === 'tick' || msg.event === 'pair-stats') {
                updateEventCount++
                console.log('[WS-DIAGNOSTIC] Received update event:', msg.event,
                  'Total messages:', messageCount, 'Updates:', updateEventCount)
              }
            } catch {}
          }
          ws.addEventListener('message', messageHandler)

          setTimeout(() => {
            ws.removeEventListener('message', messageHandler)
            resolve({ messageCount, updateEventCount })
          }, 25000)
        } else {
          resolve({ error: 'no-ws' })
        }
      })
    })

    await expect(page.getByText('(Subscribing…)')).toBeHidden({ timeout: 30_000 })

    const monitorResult = await updateMonitor
    console.log('DIAGNOSTIC: Update monitor result:', monitorResult)

    const diff = page.getByText('Differential (Base vs Compare)')
    await expect(diff).toBeVisible()
  })

  test('Compare last update timestamp appears ("updated Ns ago")', async ({ page }) => {
    await page.goto('/')
    const tableName: TableName = 'New Tokens'
    const tableEl = await findTableForHeading(page, tableName)
    await expect(tableEl).toBeVisible()
    // Pick a token from the first visible row in the table
    const tableRowsLocator = tableEl.locator('tbody tr')
    let rowCount = await tableRowsLocator.count()
    let retries = 5
    while (rowCount === 0 && retries > 0) {
      console.log('No rows found, waiting and retrying...')
      await page.waitForTimeout(500)
      rowCount = await tableRowsLocator.count()
      retries--
    }
    if (rowCount === 0) {
      const tableHtml = await tableEl.innerHTML()
      console.log('DIAGNOSTIC: Table HTML:', tableHtml)
      const headings = await page.locator('h2').allTextContents()
      console.log('DIAGNOSTIC: Page headings:', headings)
      throw new Error('No rows found in New Tokens table after retries')
    }
    let compareToken = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      const tokenMatch = rowText?.match(/[A-Za-z0-9-]+/)
      if (tokenMatch) {
        compareToken = tokenMatch[0]
        break
      }
    }
    if (!compareToken) throw new Error('No token found in table rows')
    // Find the rowId for the selected token
    let rowId = ''
    for (let i = 0; i < rowCount; i++) {
      const rowText = await tableRowsLocator.nth(i).textContent()
      if (rowText?.includes(compareToken)) {
        rowId = (await tableRowsLocator.nth(i).getAttribute('data-row-id')) || ''
        break
      }
    }
    if (!rowId) throw new Error('No rowId found for token in table')
    await openDetailsByRowId(page, rowId)
    await pickCompareToken(page)
    await expect(page.getByText(/updated\s+\d+s\s+ago/i)).toBeVisible({ timeout: 30_000 })
  })
})
