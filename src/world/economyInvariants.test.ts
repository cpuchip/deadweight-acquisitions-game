import { describe, it, expect } from 'vitest'
import { checkEconomy, type EconomySnapshot } from './economyInvariants'

function healthy(): EconomySnapshot {
  return {
    markets: {
      iron:          { current: 2, baseline: 2, pressure: 0 },
      ice:           { current: 3, baseline: 3, pressure: 0 },
      silicates:     { current: 3, baseline: 3, pressure: 0 },
      'rare-metals': { current: 10, baseline: 10, pressure: 0 },
    },
    capacities: { solar: 0, propellant: 5, foundry: 10 },
    silo: { iron: 100, ice: 0 },
    events: [{ resourceType: 'iron', type: 'spike', startTime: 0, endTime: 100, multiplier: 2 }],
    gameClock: 50,
  }
}

describe('checkEconomy', () => {
  it('reports nothing for a healthy snapshot', () => {
    expect(checkEconomy(healthy())).toEqual([])
  })

  it('allows an over-capacity silo (legal soft-cap state)', () => {
    const s = healthy()
    s.silo.iron = 999999
    expect(checkEconomy(s)).toEqual([])
  })

  it('flags a negative silo quantity', () => {
    const s = healthy(); s.silo.ice = -1
    expect(checkEconomy(s).some(m => m.includes('silo ice negative'))).toBe(true)
  })

  it('flags a negative capacity', () => {
    const s = healthy(); s.capacities.solar = -3
    expect(checkEconomy(s).some(m => m.includes('capacity solar negative'))).toBe(true)
  })

  it('flags negative pressure and non-positive baseline', () => {
    const s = healthy(); s.markets.iron.pressure = -1; s.markets.ice.baseline = 0
    const out = checkEconomy(s)
    expect(out.some(m => m.includes('pressure negative'))).toBe(true)
    expect(out.some(m => m.includes('baseline non-positive'))).toBe(true)
  })

  it('flags current price exceeding baseline', () => {
    const s = healthy(); s.markets.iron.current = 5 // baseline 2
    expect(checkEconomy(s).some(m => m.includes('exceeds baseline'))).toBe(true)
  })

  it('flags an expired event still present', () => {
    const s = healthy(); s.gameClock = 200 // event window 0–100
    expect(checkEconomy(s).some(m => m.includes('not active at clock'))).toBe(true)
  })

  it('flags a non-positive event multiplier', () => {
    const s = healthy(); s.events[0].multiplier = 0
    expect(checkEconomy(s).some(m => m.includes('multiplier non-positive'))).toBe(true)
  })
})
