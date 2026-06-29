// Pure, Phaser-free industry invariant checker for the F9 dev sweep (Phase 5).
// Detects and reports (returns messages); never mutates or throws. Unit-tested,
// mirroring world/economyInvariants.ts.

import type { ResourceType } from './worldConfig'
import type { Composition } from './composition'

export interface IndustrySnapshot {
  oreQuantity: number
  oreComposition: Composition
  asteroids: { id: string; composition: Composition; scanned: boolean }[]
  scanDesignationAsteroidIds: string[]
}

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']
const SUM_EPS = 1e-3

function sum(c: Composition): number {
  return RESOURCE_TYPES.reduce((t, r) => t + c[r], 0)
}

/** Returns industry invariant-violation messages (empty when healthy). */
export function checkIndustry(s: IndustrySnapshot): string[] {
  const v: string[] = []

  if (s.oreQuantity < 0) v.push(`ore quantity negative (${s.oreQuantity})`)
  for (const r of RESOURCE_TYPES) {
    if (s.oreComposition[r] < 0) v.push(`ore composition ${r} negative (${s.oreComposition[r]})`)
  }
  const oreSum = sum(s.oreComposition)
  if (s.oreQuantity > SUM_EPS && Math.abs(oreSum - 1) > SUM_EPS) {
    v.push(`ore composition sums to ${oreSum} (expected 1 with ore present)`)
  }

  const byId = new Map<string, { scanned: boolean }>()
  for (const a of s.asteroids) {
    byId.set(a.id, a)
    for (const r of RESOURCE_TYPES) {
      if (a.composition[r] < 0) v.push(`asteroid ${a.id} composition ${r} negative (${a.composition[r]})`)
    }
    const cs = sum(a.composition)
    if (Math.abs(cs - 1) > SUM_EPS) v.push(`asteroid ${a.id} composition sums to ${cs} (expected 1)`)
  }

  for (const astId of s.scanDesignationAsteroidIds) {
    const a = byId.get(astId)
    if (!a) v.push(`scan designation references missing asteroid ${astId}`)
    else if (a.scanned) v.push(`scan designation for already-scanned asteroid ${astId}`)
  }

  return v
}
