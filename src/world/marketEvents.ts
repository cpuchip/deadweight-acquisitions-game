// Pure, Phaser-free market-event model: occasional exogenous shocks that shift a
// resource's sell baseline for a window. Seed-driven (via world/rng.ts) and
// stateless here — the scene persists a seed counter + the active events, so
// reloading resumes the same schedule rather than rerolling.

import type { ResourceType } from './worldConfig'
import { type Rng, rngInt, rngFloat, rngWeighted } from './rng'

export type MarketEventType = 'spike' | 'glut' | 'drought'

export interface MarketEvent {
  resourceType: ResourceType
  type: MarketEventType
  startTime: number
  endTime: number
  /** Baseline multiplier while active: spike/drought > 1, glut < 1, always > 0. */
  multiplier: number
}

const RESOURCE_TYPES: ResourceType[] = ['iron', 'ice', 'silicates', 'rare-metals']

const TYPE_WEIGHTS: Record<MarketEventType, number> = { spike: 0.4, glut: 0.4, drought: 0.2 }

const TYPE_CONFIG: Record<MarketEventType, { multMin: number; multMax: number; durMin: number; durMax: number }> = {
  spike:   { multMin: 1.5, multMax: 2.5, durMin: 20,  durMax: 40 },
  glut:    { multMin: 0.4, multMax: 0.7, durMin: 30,  durMax: 60 },
  drought: { multMin: 1.3, multMax: 1.8, durMin: 90,  durMax: 150 },
}

export const EVENT_INTERVAL_MIN = 45
export const EVENT_INTERVAL_MAX = 120

/** Rolls a new event starting at `startTime`. Deterministic for a given RNG stream. */
export function rollEvent(rng: Rng, startTime: number): MarketEvent {
  const resourceType = RESOURCE_TYPES[rngInt(rng, 0, RESOURCE_TYPES.length - 1)]
  const type = rngWeighted(rng, TYPE_WEIGHTS)
  const cfg = TYPE_CONFIG[type]
  const multiplier = rngFloat(rng, cfg.multMin, cfg.multMax)
  const duration = rngFloat(rng, cfg.durMin, cfg.durMax)
  return { resourceType, type, startTime, endTime: startTime + duration, multiplier }
}

/** Seconds until the next event should spawn. */
export function nextInterval(rng: Rng): number {
  return rngFloat(rng, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX)
}

export function isActive(e: MarketEvent, now: number): boolean {
  return now >= e.startTime && now < e.endTime
}

export function isExpired(e: MarketEvent, now: number): boolean {
  return now >= e.endTime
}

/** Combined baseline multiplier for a resource at `now` — product of active events, 1 if none. */
export function combinedMultiplier(events: MarketEvent[], resourceType: ResourceType, now: number): number {
  let m = 1
  for (const e of events) {
    if (e.resourceType === resourceType && isActive(e, now)) m *= e.multiplier
  }
  return m
}
