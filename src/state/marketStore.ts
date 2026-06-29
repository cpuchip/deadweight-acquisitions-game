import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export interface ResourceMarketView {
  current: number
  baseline: number
}

/** Per-resource live sell price (current vs. baseline), mirrored from Base markets for the UI. */
export const resourceMarket = writable<Record<ResourceType, ResourceMarketView>>({
  iron:          { current: 0, baseline: 0 },
  ice:           { current: 0, baseline: 0 },
  silicates:     { current: 0, baseline: 0 },
  'rare-metals': { current: 0, baseline: 0 },
})
