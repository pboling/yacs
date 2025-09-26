// JS runtime utilities for tests (ESM)
/**
 * Derive market capitalization from a heterogeneous Scanner-like payload.
 *
 * Algorithm
 * - Consider several candidate fields that may contain the market cap, in order of preference:
 *   currentMcap, initialMcap, pairMcapUsd, pairMcapUsdInitial.
 * - Coerce each candidate to a finite number via parseFloat; pick the first > 0.
 * - If none is valid, return 0.
 *
 * Rationale
 * - Upstream sources are inconsistent across chains and routers; this selection logic reduces
 *   NaN propagation and ensures stable UI metrics without branching elsewhere.
 *
 * @param {object} scanner - Raw scanner item.
 * @returns {number} Market capitalization in USD; 0 if not provided.
 */
export function calcMarketCapFromResponse(scanner) {
  const toNum = (s) => (s ? parseFloat(s) : 0)
  const candidates = [
    scanner.currentMcap,
    scanner.initialMcap,
    scanner.pairMcapUsd,
    scanner.pairMcapUsdInitial,
  ]
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

/**
 * Normalize a raw ScannerResult-like object into a UI Token model.
 *
 * - Resolves chain name from chainId (test/dev map treats sepolia as ETH).
 * - Parses numeric fields defensively, defaulting to 0 when missing/invalid.
 * - Aggregates audit/security facets and social links with backward-compatible
 *   fallbacks (link* vs *Link legacy fields).
 * - Computes tokenCreatedTimestamp from ISO age field.
 *
 * This function is pure and safe to run in both Node and browser contexts.
 *
 * @param {object} scanner - ScannerResult-like object (see test-task-types.ts for reference).
 * @returns {object} Token model suitable for UI consumption.
 */
export function mapScannerResultToToken(scanner) {
  const chainName = chainIdToName(scanner.chainId)
  const priceUsd = parseFloat(scanner.price || '0') || 0
  const volumeUsd = parseFloat(scanner.volume || '0') || 0
  const mcap = calcMarketCapFromResponse(scanner)
  const tokenCreatedTimestamp = new Date(scanner.age)
  // Relay burn-related fields
  const totalSupply = scanner.totalSupply
  const burnedSupply = scanner.burnedSupply
  const percentBurned = scanner.percentBurned
  const deadAddress = scanner.deadAddress
  const ownerAddress = scanner.ownerAddress
  // Derive burned status
  let burned
  if (
    typeof percentBurned === 'number' &&
    typeof ownerAddress === 'string' &&
    typeof deadAddress === 'string'
  ) {
    if (percentBurned > 50 || ownerAddress.toLowerCase() === deadAddress.toLowerCase()) {
      burned = true
    } else if (percentBurned >= 0) {
      burned = false
    }
  } else {
    burned = undefined
  }
  return {
    id: scanner.pairAddress || scanner.token1Address,
    tokenName: scanner.token1Name,
    tokenSymbol: scanner.token1Symbol,
    tokenAddress: scanner.token1Address,
    pairAddress: scanner.pairAddress,
    chain: chainName,
    exchange:
      scanner.routerAddress ||
      scanner.virtualRouterType ||
      scanner.migratedFromVirtualRouter ||
      'unknown',
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
      // Social links (prefer new link* fields, fallback to legacy *Link)
      ...(scanner.linkDiscord || scanner.discordLink
        ? { linkDiscord: scanner.linkDiscord || scanner.discordLink }
        : {}),
      ...(scanner.linkTelegram || scanner.telegramLink
        ? { linkTelegram: scanner.linkTelegram || scanner.telegramLink }
        : {}),
      ...(scanner.linkTwitter || scanner.twitterLink
        ? { linkTwitter: scanner.linkTwitter || scanner.twitterLink }
        : {}),
      ...(scanner.linkWebsite || scanner.webLink
        ? { linkWebsite: scanner.linkWebsite || scanner.webLink }
        : {}),
    },
    totalSupply,
    burnedSupply,
    percentBurned,
    deadAddress,
    ownerAddress,
    security: {
      renounced: scanner.contractRenounced ?? undefined,
      locked: scanner.liquidityLocked ?? undefined,
      burned,
    },
    tokenCreatedTimestamp,
    liquidity: {
      current: parseFloat(scanner.liquidity || '0') || 0,
      changePc: parseFloat(scanner.percentChangeInLiquidity || '0') || 0,
    },
  }
}

/**
 * Apply a stream tick (batch of swaps) to a Token model, producing a new snapshot.
 *
 * Algorithm overview (cognitive hotspots):
 * 1) Price update with robust fallbacks
 *    - Take the latest non-outlier swap as the primary source of price.
 *    - If missing/invalid, scan for any non-outlier swap with a finite positive price.
 *    - If still unavailable, retain the old price to avoid NaN cascades.
 * 2) Market cap recomputation
 *    - mcap = totalSupply (from ctx) × newPrice; if invalid, keep previous mcap.
 * 3) Volume accumulation
 *    - For each non-outlier swap, volume += (effectivePrice × |amountToken1|).
 *      The effectivePrice is the swap’s own price when finite, otherwise the
 *      resolved newPrice (or oldPrice as last resort). This stabilizes volume
 *      under partial data.
 * 4) Transaction direction inference (buys vs sells)
 *    - If tokenInAddress matches known token0 → buy of token1.
 *    - Else if matches token1 → sell of token1.
 *    - Else when token0 is unknown but token1 known → treat as buy to keep
 *      counters progressing during early discovery.
 * 5) Liquidity drift model (deterministic, bounded)
 *    - Liquidity evolves by a fraction (10%) of the price percent change.
 *      nextLiq = max(0, prevLiq + prevLiq × pricePct × 0.10).
 *    - changePc is computed relative to prevLiq and expressed in percent.
 *
 * The function is side-effect free and returns a new object, preserving
 * immutability expectations in React state updates.
 *
 * @param {object} token - Current Token snapshot (UI shape).
 * @param {Array<object>} swaps - Batch of swap ticks; outliers are ignored.
 * @param {object} ctx - Context: totalSupply, token0Address, token1Address.
 * @returns {object} Next Token snapshot with updated price, mcap, volume, txns and liquidity.
 */
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
    const alt = swaps
      .filter((s) => !s.isOutlier)
      .map((s) => parseNum(s.priceToken1Usd, NaN))
      .find((n) => Number.isFinite(n) && n > 0)
    newPrice = Number.isFinite(alt) ? alt : oldPrice
  }

  const newMcap = parseNum(ctx.totalSupply, 0) * newPrice

  let buys = 0
  let sells = 0
  let volumeDelta = 0
  for (const s of swaps) {
    if (s.isOutlier) continue
    const amt1 = parseNum(s.amountToken1, 0)
    const pxParsed = parseNum(s.priceToken1Usd, NaN)
    const px = Number.isFinite(pxParsed)
      ? pxParsed
      : Number.isFinite(newPrice) && newPrice > 0
        ? newPrice
        : oldPrice
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
  const driftFactor = 0.1 // 10% of price pct change affects liquidity
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
