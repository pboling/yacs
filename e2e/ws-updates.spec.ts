import { test, expect } from '@playwright/test'

// Use shared helpers from e2e/helpers.ts
import {
  findTableForHeading,
  getCellTextByToken,
  parseCounter,
} from './helpers'

// Single focused test with a simple name (no parens) so -g regex is easy
test('NewTokensSells', async ({ page }) => {
  page.on('console', (msg) => console.log(`PAGE LOG [${msg.type()}]: ${msg.text()}`))

  console.log('DIAGNOSTIC: Starting test - navigating to /')
  await page.goto('/')

  // Wait for tables to be rendered with data
  console.log('DIAGNOSTIC: Waiting for tables to load with data...')
  await page.waitForFunction(() => {
    const tables = document.querySelectorAll('table.tokens');
    if (tables.length === 0) return false;
    // Check if at least one table has rows
    for (const table of tables) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length > 0) return true;
    }
    return false;
  }, { timeout: 30000 }).catch((err) => {
    console.log('DIAGNOSTIC: Tables load timeout. Error:', err.message);
    throw err;
  });

  console.log('DIAGNOSTIC: Tables loaded!');

  // Check what tables are available
  console.log('DIAGNOSTIC: Checking for available tables...');
  const tableInfo = await page.evaluate(() => {
    const tables = document.querySelectorAll('table.tokens');
    const headings = document.querySelectorAll('h2, h3');
    return {
      tableCount: tables.length,
      headings: Array.from(headings).map(h => h.textContent?.trim()),
      tablesWithRows: Array.from(tables).map((table, idx) => ({
        index: idx,
        rowCount: table.querySelectorAll('tbody tr').length,
        hasData: table.querySelectorAll('tbody tr').length > 0
      }))
    };
  });
  console.log('DIAGNOSTIC: Table info:', JSON.stringify(tableInfo));

  // Use Trending Tokens table
  const tableName = 'Trending Tokens'
  console.log(`DIAGNOSTIC: Looking for table with heading "${tableName}"...`);

  const tableEl = await findTableForHeading(page, tableName)
  console.log('DIAGNOSTIC: Found table element');

  // Wait a moment for any initial rendering/sorting to complete
  await page.waitForTimeout(500);

  const tableRowsLocator = tableEl.locator('tbody tr');
  const rowCount = await tableRowsLocator.count();
  console.log(`DIAGNOSTIC: [${tableName}] Row count:`, rowCount);
  if (rowCount === 0) throw new Error(`No rows found in ${tableName} table`);

  // Extract ALL tokens with their rowIds AND initial buys/sells state in one batch operation
  console.log(`DIAGNOSTIC: [${tableName}] Reading all token states from currently visible rows...`);

  const initialState = await tableEl.evaluate((table) => {
    const rows = table.querySelectorAll('tbody tr');
    const result = new Map<string, { buys: number, sells: number, maxCounter: number, rowId: string }>();
    const debugSamples: string[] = [];

    rows.forEach((row, idx) => {
      const rowId = row.getAttribute('data-row-id');
      if (!rowId) return;

      // Get token from first cell
      const firstCell = row.querySelector('td');
      if (!firstCell) return;
      const tokenMatch = firstCell.textContent?.trim().match(/[A-Za-z0-9-]+/);
      if (!tokenMatch) return;
      const token = tokenMatch[0];

      // Get buys/sells from 8th cell (nth-child is 1-indexed)
      // The B/S cell has two spans: first contains buys (with up arrow), second contains sells (with down arrow)
      const buySellCell = row.querySelector('td:nth-child(8)');
      if (!buySellCell) return;

      // Find the two spans that contain the actual numbers
      const spans = buySellCell.querySelectorAll('span > span');
      let buys = 0;
      let sells = 0;

      if (spans.length >= 2) {
        // First span (inside the "Buys" container) contains buys
        const buysText = spans[0]?.textContent?.trim() || '0';
        // Second span (inside the "Sells" container) contains sells
        const sellsText = spans[1]?.textContent?.trim() || '0';

        buys = Number(buysText.replace(/,/g, '')) || 0;
        sells = Number(sellsText.replace(/,/g, '')) || 0;

        if (idx < 3) {
          debugSamples.push(`${token}: buys="${buysText}" sells="${sellsText}"`);
        }
      } else {
        // Fallback: try to extract all numbers from the cell text
        const text = buySellCell.textContent?.trim() || '';
        const matches = text.match(/\d[\d,]*/g);
        const nums: number[] = matches ? matches.map(n => Number(n.replace(/,/g, ''))) : [];

        if (nums.length >= 2) {
          buys = nums[0];
          sells = nums[1];
        }

        if (idx < 3) {
          debugSamples.push(`${token}: fallback="${text}" -> buys=${buys} sells=${sells}`);
        }
      }

      const maxCounter = Math.max(buys, sells);

      if (isFinite(buys) && isFinite(sells)) {
        result.set(token, { buys, sells, maxCounter, rowId });
      }
    });

    // Convert Map to array of entries for serialization
    return {
      entries: Array.from(result.entries()),
      debugSamples
    };
  });

  // Convert back to Map
  const tokenStates = new Map(initialState.entries);

  console.log(`DIAGNOSTIC: [${tableName}] Sample parsed buys/sells (first 3):`, initialState.debugSamples.join(', '));
  console.log(`DIAGNOSTIC: [${tableName}] Successfully read initial state for ${tokenStates.size} tokens`);
  console.log(`DIAGNOSTIC: [${tableName}] Sample initial states (first 5):`,
    Array.from(tokenStates.entries()).slice(0, 5).map(([token, state]) =>
      `${token}: buys=${state.buys} sells=${state.sells}`
    ).join(', ')
  );

  if (tokenStates.size === 0) {
    throw new Error(`Could not read initial state for any tokens in ${tableName} table`);
  }

  // Poll all tokens, checking for any increase in buys or sells
  // Use Promise.any to succeed as soon as ANY token shows an update
  console.log(`DIAGNOSTIC: [${tableName}] Starting to poll all ${tokenStates.size} tokens for updates...`);

  await Promise.any(
    Array.from(tokenStates.entries()).map(([token, initial]) =>
      expect.poll(async () => {
        try {
          const raw = await getCellTextByToken(page, tableName, token, 8);
          if (!raw) {
            // Token not currently visible (virtualized out), skip silently
            return initial.maxCounter;
          }
          const buys = parseCounter(raw, 'buys');
          const sells = parseCounter(raw, 'sells');
          const currentMax = Math.max(buys, sells);

          // Only log if there's a change
          if (currentMax > initial.maxCounter) {
            console.log(`DIAGNOSTIC: [${tableName}] ✓ Token ${token} updated! Initial: buys=${initial.buys} sells=${initial.sells}, Current: buys=${buys} sells=${sells}`);
          } else if (currentMax !== initial.maxCounter || buys !== initial.buys || sells !== initial.sells) {
            console.log(`DIAGNOSTIC: [${tableName}] Token ${token} changed: buys=${initial.buys}→${buys} sells=${initial.sells}→${sells}`);
          }

          return currentMax;
        } catch (err) {
          // Token not visible, return initial to skip
          return initial.maxCounter;
        }
      }, {
        timeout: 60000,
        intervals: [100, 250, 500, 1000, 2000]
      }).toBeGreaterThan(initial.maxCounter)
    )
  );

  console.log(`DIAGNOSTIC: [${tableName}] Test passed! At least one token showed buys/sells increase.`);
})
