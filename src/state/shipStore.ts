import { writable } from 'svelte/store'
import type { ResourceType, SizeCategory } from '../world/worldConfig'
import type { Composition } from '../world/composition'
import type { AttachmentPoint } from './attachmentTypes'

export type ShipState =
  | 'idle'
  | 'moving'
  | 'traveling-to-base'
  | 'unloading'
  | 'in-hangar'
  | 'traveling-to-hangar'
  | 'entering-hangar'
  | 'traveling-to-asteroid'
  | 'deploying-miner'
  | 'scanning'
  | 'waiting-at-asteroid'
  | 'collecting-nets'
  | 'resupplying-miner'
  | 'responding-to-beacon'
  | 'loading-miner'
  | 'fetching-station-miner'
  | 'coasting'

export interface SelectedShipData {
  id: string
  name: string
  state: ShipState
  cargoCapacity: number
  cargoUpgradeLevel: number
  cargoContents: Partial<Record<ResourceType, number>>
  attachmentPoints: AttachmentPoint[]
  unloadProgress: number
  attachUnloadProgress: number
  collectSlotProgress: Record<number, number>
  thrusterFuel: number
  rcsFuel: number
  battery: number
  chargeToggle: boolean
}

export interface SelectedAsteroidData {
  id: string
  resourceType: ResourceType
  composition: Composition
  scanned: boolean
  currentQuantity: number
  maxQuantity: number
  sizeCategory: SizeCategory
}

export const selectedShip = writable<SelectedShipData | null>(null)
export const selectedAsteroid = writable<SelectedAsteroidData | null>(null)
