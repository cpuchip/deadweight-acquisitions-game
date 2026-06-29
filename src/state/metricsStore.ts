import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export interface PriceSample {
  t: number
  current: number
  baseline: number
}

/** Per-resource recent sell-price history (current vs. baseline) for the graphs. Ephemeral. */
export const priceHistory = writable<Record<ResourceType, PriceSample[]>>({
  iron: [], ice: [], silicates: [], 'rare-metals': [],
})
