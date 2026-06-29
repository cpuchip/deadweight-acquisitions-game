import { describe, it, expect } from 'vitest'
import { createRng } from './rng'
import { generateComposition, dominantResource, pureComposition, DOMINANT_MIN } from './composition'
import { MOON_RESOURCE_WEIGHTS, COMPANY_RESOURCE_WEIGHTS } from './worldConfig'

const RESOURCES = ['iron', 'ice', 'silicates', 'rare-metals'] as const

describe('asteroid composition', () => {
  it('produces non-negative fractions summing to 1 with a clear dominant', () => {
    for (let seed = 1; seed < 60; seed++) {
      const c = generateComposition(createRng(seed), MOON_RESOURCE_WEIGHTS)
      let sum = 0
      for (const r of RESOURCES) {
        expect(c[r]).toBeGreaterThanOrEqual(0)
        sum += c[r]
      }
      expect(sum).toBeCloseTo(1, 9)
      const dom = dominantResource(c)
      expect(c[dom]).toBeGreaterThanOrEqual(DOMINANT_MIN - 1e-9)
    }
  })

  it('dominantResource returns the max-fraction entry', () => {
    const c = generateComposition(createRng(42), MOON_RESOURCE_WEIGHTS)
    const dom = dominantResource(c)
    for (const r of RESOURCES) expect(c[dom]).toBeGreaterThanOrEqual(c[r])
  })

  it('is deterministic for a given seed + weights', () => {
    expect(generateComposition(createRng(7), MOON_RESOURCE_WEIGHTS))
      .toEqual(generateComposition(createRng(7), MOON_RESOURCE_WEIGHTS))
  })

  it('company generation skews toward high-value (rare-metals) vs moon', () => {
    const avg = (weights: typeof MOON_RESOURCE_WEIGHTS) => {
      let total = 0
      for (let seed = 1; seed < 400; seed++) total += generateComposition(createRng(seed), weights)['rare-metals']
      return total / 399
    }
    expect(avg(COMPANY_RESOURCE_WEIGHTS)).toBeGreaterThan(avg(MOON_RESOURCE_WEIGHTS))
  })

  it('pureComposition is a single-resource whole', () => {
    const c = pureComposition('iron')
    expect(c.iron).toBe(1)
    expect(c.ice).toBe(0)
    expect(dominantResource(c)).toBe('iron')
  })
})
