import { describe, it, expect } from 'vitest'
import { createRng } from './rng'
import {
  rollEvent, nextInterval, isActive, isExpired, combinedMultiplier,
  EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX, type MarketEvent,
} from './marketEvents'

const RESOURCES = ['iron', 'ice', 'silicates', 'rare-metals']

describe('market events', () => {
  it('rolls a valid, well-formed event', () => {
    for (let seed = 1; seed < 50; seed++) {
      const e = rollEvent(createRng(seed), 100)
      expect(RESOURCES).toContain(e.resourceType)
      expect(['spike', 'glut', 'drought']).toContain(e.type)
      expect(e.endTime).toBeGreaterThan(e.startTime)
      expect(e.multiplier).toBeGreaterThan(0)
      if (e.type === 'glut') expect(e.multiplier).toBeLessThan(1)
      else expect(e.multiplier).toBeGreaterThan(1)
    }
  })

  it('is deterministic for a given seed + start time', () => {
    const a = rollEvent(createRng(1234), 50)
    const b = rollEvent(createRng(1234), 50)
    expect(a).toEqual(b)
  })

  it('schedules intervals within the configured range', () => {
    for (let seed = 1; seed < 50; seed++) {
      const dt = nextInterval(createRng(seed))
      expect(dt).toBeGreaterThanOrEqual(EVENT_INTERVAL_MIN)
      expect(dt).toBeLessThanOrEqual(EVENT_INTERVAL_MAX)
    }
  })

  it('applies its multiplier only within the window', () => {
    const e: MarketEvent = { resourceType: 'iron', type: 'spike', startTime: 100, endTime: 130, multiplier: 2 }
    expect(isActive(e, 99)).toBe(false)
    expect(isActive(e, 100)).toBe(true)
    expect(isActive(e, 129.9)).toBe(true)
    expect(isActive(e, 130)).toBe(false)
    expect(isExpired(e, 130)).toBe(true)
    expect(combinedMultiplier([e], 'iron', 99)).toBe(1)
    expect(combinedMultiplier([e], 'iron', 110)).toBe(2)
    expect(combinedMultiplier([e], 'iron', 130)).toBe(1)
  })

  it('multiplier is 1 for a resource with no active event', () => {
    const e: MarketEvent = { resourceType: 'iron', type: 'spike', startTime: 0, endTime: 100, multiplier: 2 }
    expect(combinedMultiplier([e], 'ice', 50)).toBe(1)
    expect(combinedMultiplier([], 'iron', 50)).toBe(1)
  })

  it('stacks overlapping same-resource events multiplicatively', () => {
    const a: MarketEvent = { resourceType: 'iron', type: 'spike', startTime: 0, endTime: 100, multiplier: 2 }
    const b: MarketEvent = { resourceType: 'iron', type: 'drought', startTime: 0, endTime: 100, multiplier: 1.5 }
    expect(combinedMultiplier([a, b], 'iron', 50)).toBeCloseTo(3, 9)
  })
})
