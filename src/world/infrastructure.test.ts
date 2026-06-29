import { describe, it, expect } from 'vitest'
import { effectivePrice, investCapacity, PRICE_FLOOR_FRACTION, CAPACITY_PER_RESOURCE_UNIT } from './infrastructure'

describe('cost-lever infrastructure model', () => {
  it('charges the base price at zero capacity', () => {
    expect(effectivePrice(20, 0, 5)).toBe(20)
  })

  it('lowers price as capacity grows, never below the floor', () => {
    const base = 20
    const demand = 5
    const p1 = effectivePrice(base, 5, demand)
    const p2 = effectivePrice(base, 50, demand)
    const p3 = effectivePrice(base, 5000, demand)
    expect(p1).toBeLessThan(base)
    expect(p2).toBeLessThan(p1)
    expect(p3).toBeGreaterThanOrEqual(base * PRICE_FLOOR_FRACTION)
    expect(p3).toBeCloseTo(base * PRICE_FLOOR_FRACTION, 5)
  })

  it('raises price back toward base as fleet demand grows (fixed capacity)', () => {
    const base = 20
    const capacity = 20
    const pLow = effectivePrice(base, capacity, 2)
    const pHigh = effectivePrice(base, capacity, 20)
    expect(pHigh).toBeGreaterThan(pLow)
    expect(pHigh).toBeLessThanOrEqual(base)
  })

  it('never exceeds base and never drops below the floor', () => {
    for (const cap of [0, 1, 100, 1e6]) {
      for (const dem of [0, 1, 10, 1000]) {
        const p = effectivePrice(20, cap, dem)
        expect(p).toBeLessThanOrEqual(20)
        expect(p).toBeGreaterThanOrEqual(20 * PRICE_FLOOR_FRACTION - 1e-9)
      }
    }
  })

  it('returns nominal base price when nothing is owned and nothing built', () => {
    expect(effectivePrice(20, 0, 0)).toBe(20)
  })

  it('invests resource units into capacity linearly', () => {
    expect(investCapacity(0, 100)).toBeCloseTo(100 * CAPACITY_PER_RESOURCE_UNIT, 9)
    expect(investCapacity(10, 0)).toBe(10)
    expect(investCapacity(10, -5)).toBe(10)
  })
})
