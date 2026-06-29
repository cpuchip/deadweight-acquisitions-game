import { describe, it, expect } from 'vitest'
import { makeMarket, currentPrice, sell, recover, MARKET_PRESSURE_HALFLIFE } from './market'

describe('resource market elasticity', () => {
  it('prices at baseline when undepressed', () => {
    const m = makeMarket(10)
    expect(currentPrice(m)).toBe(10)
  })

  it('depresses the price after a sale', () => {
    const m = makeMarket(10)
    const { market } = sell(m, 300)
    expect(currentPrice(market)).toBeLessThan(10)
    expect(currentPrice(market)).toBeGreaterThan(0)
  })

  it('a big dump earns less per unit than small lots spaced over time', () => {
    const baseline = 10
    const qty = 600

    // One big dump.
    const dump = sell(makeMarket(baseline), qty)
    const dumpPerUnit = dump.revenue / qty

    // Same total in 6 lots of 100, recovering a half-life between each.
    let m = makeMarket(baseline)
    let revenue = 0
    let sold = 0
    for (let i = 0; i < 6; i++) {
      const r = sell(m, 100)
      revenue += r.revenue
      m = recover(r.market, MARKET_PRESSURE_HALFLIFE)
      sold += 100
    }
    const spacedPerUnit = revenue / sold

    expect(spacedPerUnit).toBeGreaterThan(dumpPerUnit)
  })

  it('recovers toward baseline over time, never above it', () => {
    const m0 = makeMarket(10)
    const sold = sell(m0, 1000).market
    const depressed = currentPrice(sold)
    const after = recover(sold, MARKET_PRESSURE_HALFLIFE * 4)
    const recovered = currentPrice(after)
    expect(recovered).toBeGreaterThan(depressed)
    expect(recovered).toBeLessThanOrEqual(10)
  })

  it('rests exactly at baseline after long recovery', () => {
    const sold = sell(makeMarket(10), 500).market
    const after = recover(sold, MARKET_PRESSURE_HALFLIFE * 20)
    expect(after.pressure).toBe(0)
    expect(currentPrice(after)).toBe(10)
  })

  it('never goes to zero or negative even for an enormous sale', () => {
    const m = sell(makeMarket(10), 1_000_000).market
    expect(currentPrice(m)).toBeGreaterThan(0)
  })

  it('selling one market leaves another untouched', () => {
    const a = makeMarket(10)
    const b = makeMarket(3)
    sell(a, 500)
    expect(b.pressure).toBe(0)
    expect(currentPrice(b)).toBe(3)
  })

  it('selling zero is a no-op', () => {
    const m = makeMarket(10)
    const r = sell(m, 0)
    expect(r.revenue).toBe(0)
    expect(r.market).toBe(m)
  })
})
