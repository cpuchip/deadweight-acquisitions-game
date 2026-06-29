// Pure, Phaser-free resource-market model: player-driven sell-price elasticity.
//
// Each resource has a baseline price and a "pressure" accumulator representing
// how much the player has recently flooded the market with it. Selling raises
// pressure (depressing the price); pressure decays exponentially toward zero
// over time, so the price recovers toward baseline when the player holds off.
//
// Kept pure (no Phaser, no stores) so it is unit-tested directly under Vitest.

export interface ResourceMarket {
  /** Standing value of the resource, absent depression (WI 528 will modulate this). */
  baseline: number
  /** Recent-sales pressure; 0 = price at baseline. Always >= 0. */
  pressure: number
}

/** Units of pressure at which the price is halved. Higher = a deeper, less elastic market. */
export const MARKET_DEPTH = 300

/** Pressure half-life in seconds: time for accumulated pressure to halve while idle. */
export const MARKET_PRESSURE_HALFLIFE = 30

const DECAY_LAMBDA = Math.LN2 / MARKET_PRESSURE_HALFLIFE

export function makeMarket(baseline: number): ResourceMarket {
  return { baseline, pressure: 0 }
}

/**
 * Current per-unit sell price. Always in (0, baseline]: pressure >= 0 makes the
 * denominator >= 1, so the price never exceeds baseline and never reaches zero.
 */
export function currentPrice(m: ResourceMarket): number {
  return m.baseline / (1 + m.pressure / MARKET_DEPTH)
}

/**
 * Revenue realized by selling `qty` now, plus the resulting market state.
 * Prices across the batch at the midpoint pressure, so a large dump earns
 * progressively less per unit than the same quantity sold in small lots over
 * time (which lets pressure decay between sales).
 */
export function sell(m: ResourceMarket, qty: number): { revenue: number; market: ResourceMarket } {
  if (qty <= 0) return { revenue: 0, market: m }
  const midPressure = m.pressure + qty / 2
  const midPrice = m.baseline / (1 + midPressure / MARKET_DEPTH)
  return {
    revenue: qty * midPrice,
    market: { baseline: m.baseline, pressure: m.pressure + qty },
  }
}

/** Advances recovery: pressure decays exponentially toward zero over `dt` seconds. */
export function recover(m: ResourceMarket, dt: number): ResourceMarket {
  if (m.pressure <= 0 || dt <= 0) return m
  const pressure = m.pressure * Math.exp(-DECAY_LAMBDA * dt)
  // Snap tiny residuals to zero so the price rests exactly at baseline.
  return { baseline: m.baseline, pressure: pressure < 1e-3 ? 0 : pressure }
}
