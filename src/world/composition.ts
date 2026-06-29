// Pure, Phaser-free asteroid composition model (Phase 5). An asteroid's
// composition is a dominant resource (the majority of its mass, which remains its
// visual/mining identity) plus minor traces of the others, normalized to sum to 1.
// Trace distribution is weighted by the region's resource weights, so company
// asteroids (high-value-weighted) carry high-value traces as well as a skewed
// dominant. Composition is latent until WI 541 (ore) consumes it and WI 542
// (scanner) reveals it.

import { type Rng, rngWeighted, rngFloat } from './rng'
import type { ResourceType } from './worldConfig'

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

/** Fraction of the asteroid that is its dominant resource (rest distributed as traces). */
export const DOMINANT_MIN = 0.6
export const DOMINANT_MAX = 0.85

export type Composition = Record<ResourceType, number>

/** Generates a normalized composition: a weighted-pick dominant plus weight-distributed traces. */
export function generateComposition(rng: Rng, weights: Record<ResourceType, number>): Composition {
  const dominant = rngWeighted(rng, weights)
  const dominantFraction = rngFloat(rng, DOMINANT_MIN, DOMINANT_MAX)
  const others = RESOURCE_TYPES.filter(t => t !== dominant)
  const otherWeightTotal = others.reduce((sum, t) => sum + weights[t], 0)
  const remainder = 1 - dominantFraction

  const comp = { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 } as Composition
  comp[dominant] = dominantFraction
  for (const t of others) {
    comp[t] = otherWeightTotal > 0
      ? remainder * (weights[t] / otherWeightTotal)
      : remainder / others.length
  }
  return comp
}

/** Pure-single-resource composition (for legacy migration of a single-resource asteroid). */
export function pureComposition(resource: ResourceType): Composition {
  const comp = { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 } as Composition
  comp[resource] = 1
  return comp
}

/** The dominant (max-fraction) resource — the asteroid's identity. */
export function dominantResource(comp: Composition): ResourceType {
  let best: ResourceType = 'iron'
  let bestValue = -Infinity
  for (const t of RESOURCE_TYPES) {
    if (comp[t] > bestValue) {
      bestValue = comp[t]
      best = t
    }
  }
  return best
}
