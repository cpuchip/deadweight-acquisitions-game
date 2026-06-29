import { writable } from 'svelte/store'
import type { ResourceType } from '../world/worldConfig'

export interface BaseState {
  storage: Partial<Record<ResourceType, number>>
  storageCapacity: number
  credits: number
  fleetSize: number
  stationMinerCount: number
  stationMinerSlotCount: number
  ownedDockCount: number
  ownedHangarCount: number
  hangarPressurized: boolean
  autoDesignate: boolean
  scannerCount: number
}

export const baseState = writable<BaseState>({
  storage: {},
  storageCapacity: 0,
  credits: 0,
  fleetSize: 0,
  stationMinerCount: 0,
  stationMinerSlotCount: 0,
  ownedDockCount: 0,
  ownedHangarCount: 0,
  hangarPressurized: false,
  autoDesignate: false,
  scannerCount: 0,
})

export const basePanelOpen = writable<boolean>(true) // pinned open by default; closed only via the panel's X

export interface StationUsage {
  minersStored: number
  minerSlots: number
  ownedDocksInUse: number
  ownedDocksTotal: number
  publicDocksInUse: number // ships docked at a public (fee) dock; public docks are unlimited
  hangarsInUse: number
  hangarsTotal: number
  publicHangarsInUse: number
}

export const stationUsage = writable<StationUsage>({
  minersStored: 0,
  minerSlots: 0,
  ownedDocksInUse: 0,
  ownedDocksTotal: 0,
  publicDocksInUse: 0,
  hangarsInUse: 0,
  hangarsTotal: 0,
  publicHangarsInUse: 0,
})
