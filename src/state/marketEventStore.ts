import { writable } from 'svelte/store'
import type { MarketEvent } from '../world/marketEvents'

/** Currently-active market events, mirrored from the scene for the HUD. */
export const activeMarketEvents = writable<MarketEvent[]>([])
