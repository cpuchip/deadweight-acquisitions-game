import { describe, it, expect } from 'vitest'
import { separate, blendOre } from './processing'
import { pureComposition } from './composition'
import type { Composition } from './composition'

const comp = (iron: number, ice: number, silicates: number, rm: number): Composition =>
  ({ iron, ice, silicates, 'rare-metals': rm })

describe('ore processing', () => {
  it('separation conserves mass', () => {
    const out = separate(100, comp(0.7, 0.1, 0.15, 0.05))
    const sum = out.iron + out.ice + out.silicates + out['rare-metals']
    expect(sum).toBeCloseTo(100, 9)
  })

  it('separation distributes by composition', () => {
    const out = separate(100, comp(0.7, 0.1, 0.15, 0.05))
    expect(out.iron).toBeCloseTo(70, 9)
    expect(out['rare-metals']).toBeCloseTo(5, 9)
  })

  it('pure-composition ore separates to a single resource', () => {
    const out = separate(50, pureComposition('iron'))
    expect(out.iron).toBe(50)
    expect(out.ice).toBe(0)
  })

  it('blends mass-weighted and stays normalized', () => {
    const a = comp(1, 0, 0, 0)
    const b = comp(0, 1, 0, 0)
    const { quantity, composition } = blendOre(75, a, 25, b)
    expect(quantity).toBe(100)
    expect(composition.iron).toBeCloseTo(0.75, 9)
    expect(composition.ice).toBeCloseTo(0.25, 9)
    const sum = composition.iron + composition.ice + composition.silicates + composition['rare-metals']
    expect(sum).toBeCloseTo(1, 9)
  })

  it('blending into an empty silo adopts the incoming composition', () => {
    const empty = comp(0, 0, 0, 0)
    const incoming = comp(0.6, 0.4, 0, 0)
    const { quantity, composition } = blendOre(0, empty, 30, incoming)
    expect(quantity).toBe(30)
    expect(composition.iron).toBeCloseTo(0.6, 9)
  })

  it('round-trips ore through blend then separate without loss', () => {
    const r1 = blendOre(0, comp(0, 0, 0, 0), 40, comp(0.5, 0.5, 0, 0))
    const r2 = blendOre(r1.quantity, r1.composition, 60, comp(0, 0, 1, 0))
    const out = separate(r2.quantity, r2.composition)
    const sum = out.iron + out.ice + out.silicates + out['rare-metals']
    expect(sum).toBeCloseTo(100, 9)
    expect(out.silicates).toBeCloseTo(60, 9) // 60 units of pure silicates ore
  })
})
