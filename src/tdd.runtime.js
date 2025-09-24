// JS runtime utilities for tests (ESM)
export function calcMarketCapFromResponse(scanner) {
  const toNum = (s) => (s ? parseFloat(s) : 0)
  const candidates = [scanner.currentMcap, scanner.initialMcap, scanner.pairMcapUsd, scanner.pairMcapUsdInitial]
  for (const c of candidates) {
    const v = toNum(c)
    if (v > 0) return v
  }
  return 0
}

function chainIdToName(chainId) {
  const map = {
    1: 'ETH',
    56: 'BSC',
    8453: 'BASE',
    900: 'SOL',
    11155111: 'ETH', // sepolia -> treat as ETH for display
  }
  return map[Number(chainId)] ?? 'ETH'
}

export function mapScannerResultToToken(scanner) {
  const chainName = chainIdToName(scanner.chainId)
  const priceUsd = parseFloat(scanner.price || '0') || 0
  const volumeUsd = parseFloat(scanner.volume || '0') || 0
  const mcap = calcMarketCapFromResponse(scanner)
  const tokenCreatedTimestamp = new Date(scanner.age)
  return {
    id: scanner.pairAddress || scanner.token1Address,
    tokenName: scanner.token1Name,
    tokenSymbol: scanner.token1Symbol,
    tokenAddress: scanner.token1Address,
    pairAddress: scanner.pairAddress,
    chain: chainName,
    exchange: scanner.routerAddress || scanner.virtualRouterType || scanner.migratedFromVirtualRouter || 'unknown',
    priceUsd,
    volumeUsd,
    mcap,
    priceChangePcs: {
      '5m': parseFloat(scanner.diff5M || '0') || 0,
      '1h': parseFloat(scanner.diff1H || '0') || 0,
      '6h': parseFloat(scanner.diff6H || '0') || 0,
      '24h': parseFloat(scanner.diff24H || '0') || 0,
    },
    transactions: {
      buys: scanner.buys ?? 0,
      sells: scanner.sells ?? 0,
    },
    audit: {
      mintable: !scanner.isMintAuthDisabled,
      freezable: !scanner.isFreezeAuthDisabled,
      honeypot: !!scanner.honeyPot,
      contractVerified: scanner.contractVerified,
    },
    security: {
      renounced: scanner.contractRenounced ?? undefined,
      locked: scanner.liquidityLocked ?? undefined,
      burned: scanner.burned ?? undefined,
    },
    tokenCreatedTimestamp,
    liquidity: {
      current: parseFloat(scanner.liquidity || '0') || 0,
      changePc: parseFloat(scanner.percentChangeInLiquidity || '0') || 0,
    },
  }
}

export function applyTickToToken(token, swaps, ctx) {
  const latest = swaps.filter((s) => !s.isOutlier).pop()
  if (!latest) return token

  const parseNum = (v, def = 0) => {
    const n = typeof v === 'number' ? v : parseFloat(v || '0')
    return Number.isFinite(n) ? n : def
  }

  const oldPrice = parseNum(token.priceUsd, 0)
  let newPrice = parseNum(latest.priceToken1Usd, NaN)
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    // Fallback: try any other non-outlier swap price, otherwise keep old price
    const alt = swaps.filter((s) => !s.isOutlier).map((s) => parseNum(s.priceToken1Usd, NaN)).find((n) => Number.isFinite(n) && n > 0)
    newPrice = Number.isFinite(alt) ? alt : oldPrice
  }

  const newMcap = (parseNum(ctx.totalSupply, 0)) * newPrice

  let buys = 0
  let sells = 0
  let volumeDelta = 0
  for (const s of swaps) {
    if (s.isOutlier) continue
    const amt1 = parseNum(s.amountToken1, 0)
    const pxParsed = parseNum(s.priceToken1Usd, NaN)
    const px = Number.isFinite(pxParsed) ? pxParsed : (Number.isFinite(newPrice) && newPrice > 0 ? newPrice : oldPrice)
    volumeDelta += px * Math.abs(amt1)
    const tin = (s.tokenInAddress || '').toLowerCase()
    const t0 = (ctx.token0Address || '').toLowerCase()
    const t1 = (ctx.token1Address || '').toLowerCase()
    if (t0 && tin === t0) {
      // Known base token0 coming in => buying token1
      buys++
    } else if (t1 && tin === t1) {
      // Token1 coming in => selling token1
      sells++
    } else if (!t0 && t1) {
      // Fallback inference when token0 unknown: if tokenIn is not token1, treat as a buy
      // This ensures buys counter updates even before token0Address is learned from WS stream
      buys++
    }
  }

  // Deterministic liquidity evolution driven by price percent change per tick.
  // We let liquidity drift by a fraction (10%) of the price percentage change.
  const prevLiq = token.liquidity?.current ?? 0
  const pricePct = oldPrice > 0 && newPrice > 0 ? (newPrice - oldPrice) / oldPrice : 0
  const driftFactor = 0.10 // 10% of price pct change affects liquidity
  const liqDelta = prevLiq * pricePct * driftFactor
  const nextLiq = Math.max(0, prevLiq + liqDelta)
  const liqChangePc = prevLiq > 0 ? ((nextLiq - prevLiq) / prevLiq) * 100 : 0

  return {
    ...token,
    priceUsd: Number.isFinite(newPrice) ? newPrice : oldPrice,
    mcap: Number.isFinite(newMcap) ? newMcap : token.mcap,
    volumeUsd: token.volumeUsd + volumeDelta,
    transactions: {
      buys: token.transactions.buys + buys,
      sells: token.transactions.sells + sells,
    },
    liquidity: {
      current: nextLiq,
      changePc: liqChangePc,
    },
  }
}
