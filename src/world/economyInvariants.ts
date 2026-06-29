// Pure, Phaser-free economy invariant checker for the F9 dev sweep. Detects and
// reports (returns messages); never mutates or throws. Unit-tested so the dev
// guarantees are verified, not merely observed on-screen.

import type { ResourceType } from './worldConfig'
import type { MarketEvent } from './marketEvents'

export interface EconomySnapshot {
  markets: Record<ResourceType, { current: number; baseline: number; pressure: number }>
  capacities: { solar: number; propellant: number; foundry: number }
  silo: Partial<Record<ResourceType, number>>
  events: MarketEvent[]
  gameClock: number
}

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']
const EPS = 1e-6

/** Returns a list of invariant-violation messages (empty when the economy is healthy). */
export function checkEconomy(s: EconomySnapshot): string[] {
  const v: string[] = []

  for (const type of RESOURCE_TYPES) {
    // Silo over-capacity is legal (soft cap, WI 525) and is deliberately not checked;
    // only negative (corrupt) quantities are a violation.
    const qty = s.silo[type] ?? 0
    if (qty < 0) v.push(`silo ${type} negative (${qty})`)

    const m = s.markets[type]
    if (m.pressure < 0) v.push(`market ${type} pressure negative (${m.pressure})`)
    if (m.baseline <= 0) v.push(`market ${type} baseline non-positive (${m.baseline})`)
    if (m.current <= 0) v.push(`market ${type} current non-positive (${m.current})`)
    if (m.current > m.baseline + EPS) v.push(`market ${type} current ${m.current} exceeds baseline ${m.baseline}`)
  }

  for (const [lever, cap] of Object.entries(s.capacities)) {
    if (cap < 0) v.push(`capacity ${lever} negative (${cap})`)
  }

  for (const e of s.events) {
    if (!(s.gameClock >= e.startTime && s.gameClock < e.endTime)) {
      v.push(`event ${e.resourceType} ${e.type} not active at clock ${s.gameClock} (window ${e.startTime}–${e.endTime})`)
    }
    if (e.multiplier <= 0) v.push(`event ${e.resourceType} ${e.type} multiplier non-positive (${e.multiplier})`)
  }

  return v
}
