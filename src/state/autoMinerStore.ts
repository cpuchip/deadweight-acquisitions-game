import { writable } from 'svelte/store'
import type { AutoMinerState, BeaconReason } from '../entities/AutoMiner'

export interface SelectedAutoMinerData {
  id: string
  state: AutoMinerState
  condition: number
  asteroidId: string | null
  activeNetFill: number
  spareNetCount: number
  tetheredNetCount: number
  battery: number
  beaconReason: BeaconReason
}

export interface BeaconData {
  id: string
  x: number
  y: number
}

export interface AutoMinerSummary {
  mining: number
  netStarved: number
  beaconing: number
  dark: number
  stuck: number
}

export interface AttachNotification {
  id: string
  message: string
  exhausted: boolean
}

export interface MinerAvailability {
  available: number
  demanded: number
  shortage: boolean
}

export const selectedAutoMiner = writable<SelectedAutoMinerData | null>(null)
export const activeBeacons = writable<BeaconData[]>([])
export const autoMinerSummary = writable<AutoMinerSummary>({ mining: 0, netStarved: 0, beaconing: 0, dark: 0, stuck: 0 })
export const attachNotifications = writable<AttachNotification[]>([])
export const minerAvailability = writable<MinerAvailability>({ available: 0, demanded: 0, shortage: false })
