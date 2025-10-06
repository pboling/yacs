import { generateScannerResponse } from '../src/scanner.endpoint.js'

const params = { page: 1 }
const ticks = 10
const requiredChangeFraction = 0.7 // require >=70% of consecutive ticks to show change per metric
const requiredTokenPassFraction = 0.6 // require >=60% of sampled tokens to meet the above

function analyzeTokenSeries(values) {
  let changes = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1]) changes++
  }
  return changes / (values.length - 1)
}

function run() {
  console.log('Running frequent-updates check')
  const tickResults = []
  for (let t = 0; t <= ticks; t++) {
    tickResults.push(generateScannerResponse(params, t).scannerPairs)
  }

  const map = new Map()
  for (let t = 0; t <= ticks; t++) {
    const arr = tickResults[t]
    for (const p of arr) {
      const key = p.token1Name || p.token1Symbol || p.pairAddress
      if (!map.has(key)) map.set(key, { buys: [], sells: [] })
      const v = map.get(key)
      v.buys.push(p.buys)
      v.sells.push(p.sells)
    }
  }

  const entries = Array.from(map.entries()).slice(0, 200) // sample up to 200 tokens
  let okCount = 0
  const details = []
  for (const [k, v] of entries) {
    const bf = analyzeTokenSeries(v.buys)
    const sf = analyzeTokenSeries(v.sells)
    details.push({
      token: k,
      buyChangeFraction: bf,
      sellChangeFraction: sf,
      buys: v.buys.slice(0, 12),
      sells: v.sells.slice(0, 12),
    })
    if (Math.max(bf, sf) >= requiredChangeFraction) okCount++
  }

  const passRatio = entries.length ? okCount / entries.length : 0
  console.log(
    `Analyzed ${entries.length} tokens; ${okCount} (${(passRatio * 100).toFixed(1)}%) meet required change fraction >= ${requiredChangeFraction}`,
  )

  // Print samples: failing and passing
  const failing = details
    .filter((d) => Math.max(d.buyChangeFraction, d.sellChangeFraction) < requiredChangeFraction)
    .slice(0, 6)
  const passing = details
    .filter((d) => Math.max(d.buyChangeFraction, d.sellChangeFraction) >= requiredChangeFraction)
    .slice(0, 6)

  if (passing.length) {
    console.log('\nExamples (passing):')
    for (const p of passing) {
      console.log(
        `- ${p.token}: buyFrac=${p.buyChangeFraction.toFixed(2)} sellFrac=${p.sellChangeFraction.toFixed(2)} buys=[${p.buys.join(',')}] sells=[${p.sells.join(',')}]`,
      )
    }
  }
  if (failing.length) {
    console.log('\nExamples (failing):')
    for (const p of failing) {
      console.log(
        `- ${p.token}: buyFrac=${p.buyChangeFraction.toFixed(2)} sellFrac=${p.sellChangeFraction.toFixed(2)} buys=[${p.buys.join(',')}] sells=[${p.sells.join(',')}]`,
      )
    }
  }

  if (passRatio < requiredTokenPassFraction) {
    console.error(
      `\nFAIL: only ${(passRatio * 100).toFixed(1)}% of sampled tokens meet the frequency requirement (need ${(requiredTokenPassFraction * 100).toFixed(1)}%).`,
    )
    process.exitCode = 2
  } else {
    console.log(
      `\nPASS: ${(passRatio * 100).toFixed(1)}% of sampled tokens meet the frequency requirement`,
    )
  }
}

run()
