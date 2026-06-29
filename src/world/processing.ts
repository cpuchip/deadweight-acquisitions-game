// Pure, Phaser-free ore-processing model (Phase 5): separate raw ore into its
// constituent resources by composition, and blend incoming ore into the silo's
// aggregate. Conserves mass — the defining property, unit-tested. The scene
// drives the timed processing service; this module holds the math.

import type { ResourceType } from './worldConfig'
import type { Composition } from './composition'

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

/** Ore units processed per second by the (public) processing service. */
export const PROCESSING_RATE = 8

const EMPTY = (): Composition => ({ iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 })

/** Separates `oreQty` of ore into per-resource amounts by composition. Sum equals `oreQty`. */
export function separate(oreQty: number, comp: Composition): Record<ResourceType, number> {
  const out = EMPTY() as Record<ResourceType, number>
  for (const t of RESOURCE_TYPES) out[t] = oreQty * comp[t]
  return out
}

/** Mass-weighted blend of an incoming ore batch into an aggregate; composition stays normalized. */
export function blendOre(
  qtyA: number, compA: Composition,
  qtyB: number, compB: Composition,
): { quantity: number; composition: Composition } {
  const total = qtyA + qtyB
  const comp = EMPTY()
  if (total <= 0) return { quantity: 0, composition: comp }
  for (const t of RESOURCE_TYPES) comp[t] = (qtyA * compA[t] + qtyB * compB[t]) / total
  return { quantity: total, composition: comp }
}
