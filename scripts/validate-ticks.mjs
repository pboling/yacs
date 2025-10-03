import { generateScannerResponse } from '../src/scanner.endpoint.js'

const params = { page: 1 }
const tokenName = 'wafd-ETH'

console.log('Validating buys/sells monotonicity for token:', tokenName)

for (let tick = 0; tick <= 10; tick++) {
  const res = generateScannerResponse(params, tick)
  const found = res.scannerPairs.find(p => p.token1Name === tokenName)
  if (found) {
    console.log(`tick=${tick} -> buys=${found.buys} sells=${found.sells} token=${found.token1Name}`)
  } else {
    // print first few tokens for visibility
    console.log(`tick=${tick} -> token not found; sample:`)
    for (let i = 0; i < Math.min(5, res.scannerPairs.length); i++) {
      const s = res.scannerPairs[i]
      console.log(`  [${i}] ${s.token1Name} buys=${s.buys} sells=${s.sells}`)
    }
  }
}

