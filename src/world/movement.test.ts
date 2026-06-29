import { describe, it, expect } from 'vitest'
import { flybyScale, asteroidProximityRadius } from './movement'

const MIN = 0.25
const MAX = 1.3

describe('flybyScale', () => {
  it('is 1.0 at cruise (speedMultiplier = 1)', () => {
    expect(flybyScale(1, MIN, MAX)).toBeCloseTo(1.0)
  })

  it('is maxScale at full slowdown (speedMultiplier = minSpeed)', () => {
    expect(flybyScale(MIN, MIN, MAX)).toBeCloseTo(MAX)
  })

  it('interpolates at the midpoint', () => {
    // speedMultiplier 0.625 → t = (1-0.625)/0.75 = 0.5 → 1 + 0.3*0.5 = 1.15
    expect(flybyScale(0.625, MIN, MAX)).toBeCloseTo(1.15)
  })

  it('clamps above 1 and below minSpeed', () => {
    expect(flybyScale(2, MIN, MAX)).toBeCloseTo(1.0)   // above cruise → no growth
    expect(flybyScale(0, MIN, MAX)).toBeCloseTo(MAX)   // below floor → capped growth
  })
})

describe('asteroidProximityRadius', () => {
  it('scales the base radius by size category', () => {
    expect(asteroidProximityRadius(120, 'small')).toBeCloseTo(60)
    expect(asteroidProximityRadius(120, 'medium')).toBeCloseTo(120)
    expect(asteroidProximityRadius(120, 'large')).toBeCloseTo(192)
  })

  it('orders small < medium < large, all below the planet radius (600)', () => {
    const s = asteroidProximityRadius(120, 'small')
    const m = asteroidProximityRadius(120, 'medium')
    const l = asteroidProximityRadius(120, 'large')
    expect(s).toBeLessThan(m)
    expect(m).toBeLessThan(l)
    expect(l).toBeLessThan(600)
  })
})
