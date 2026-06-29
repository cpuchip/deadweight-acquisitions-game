import { writable } from 'svelte/store'
import type { Composition } from '../world/composition'

export interface OreSiloView {
  quantity: number
  capacity: number
  composition: Composition
  /** True while the processing service is actively draining ore this tick. */
  processing: boolean
}

/** Raw-ore silo level + aggregate composition + processing status, mirrored from the scene for the UI. */
export const oreSilo = writable<OreSiloView>({
  quantity: 0,
  capacity: 0,
  composition: { iron: 0, ice: 0, silicates: 0, 'rare-metals': 0 },
  processing: false,
})
