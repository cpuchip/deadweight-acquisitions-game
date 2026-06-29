import { describe, it, expect } from 'vitest'
import { checkIndustry, type IndustrySnapshot } from './industryInvariants'
import type { Composition } from './composition'

const comp = (iron: number, ice: number, sil: number, rm: number): Composition =>
  ({ iron, ice, silicates: sil, 'rare-metals': rm })

function healthy(): IndustrySnapshot {
  return {
    oreQuantity: 100,
    oreComposition: comp(0.5, 0.2, 0.2, 0.1),
    asteroids: [
      { id: 'a1', composition: comp(0.7, 0.1, 0.15, 0.05), scanned: false },
      { id: 'a2', composition: comp(0, 0, 0, 1), scanned: true },
    ],
    scanDesignationAsteroidIds: ['a1'],
  }
}

describe('checkIndustry', () => {
  it('reports nothing for a healthy snapshot', () => {
    expect(checkIndustry(healthy())).toEqual([])
  })

  it('allows empty ore (composition sums to 0)', () => {
    const s = healthy(); s.oreQuantity = 0; s.oreComposition = comp(0, 0, 0, 0)
    expect(checkIndustry(s)).toEqual([])
  })

  it('flags negative ore quantity', () => {
    const s = healthy(); s.oreQuantity = -5
    expect(checkIndustry(s).some(m => m.includes('ore quantity negative'))).toBe(true)
  })

  it('flags ore composition not summing to 1 with ore present', () => {
    const s = healthy(); s.oreComposition = comp(0.5, 0.2, 0.2, 0.2) // 1.1
    expect(checkIndustry(s).some(m => m.includes('ore composition sums'))).toBe(true)
  })

  it('flags an asteroid composition not summing to 1', () => {
    const s = healthy(); s.asteroids[0].composition = comp(0.5, 0, 0, 0)
    expect(checkIndustry(s).some(m => m.includes('a1 composition sums'))).toBe(true)
  })

  it('flags a negative asteroid fraction', () => {
    const s = healthy(); s.asteroids[0].composition = comp(1.1, -0.1, 0, 0)
    expect(checkIndustry(s).some(m => m.includes('a1 composition iron') || m.includes('negative'))).toBe(true)
  })

  it('flags a scan designation for an already-scanned asteroid', () => {
    const s = healthy(); s.scanDesignationAsteroidIds = ['a2'] // a2 is scanned
    expect(checkIndustry(s).some(m => m.includes('already-scanned asteroid a2'))).toBe(true)
  })

  it('flags a scan designation referencing a missing asteroid', () => {
    const s = healthy(); s.scanDesignationAsteroidIds = ['ghost']
    expect(checkIndustry(s).some(m => m.includes('missing asteroid ghost'))).toBe(true)
  })
})
